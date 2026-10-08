// NOTE: xlsx, mammoth, and pdf-parse are lazy-required inside functions
// to prevent Vercel serverless cold-start crashes (pdf-parse in particular
// runs file I/O at module load time which fails in Lambda environments).
const path = require('path');
const Job = require('../models/Job');
const JobCategory = require('../models/JobCategory');

/**
 * Normalizes text for comparison (strips diacritics, extra spaces, lowercases)
 */
function normalizeForComparison(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove Arabic Tashkeel
    .replace(/[إأآا]/g, 'ا') // normalize Alef
    .replace(/[ة]/g, 'ه')   // normalize Ta Marbuta
    .replace(/[ى]/g, 'ي')   // normalize Alef Maksura
    .replace(/[^\w\s\u0600-\u06FF]/gi, ' ') // replace punctuation with space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Common table header words to ignore
 */
const JUNK_HEADERS = new Set([
  'job title', 'job titles', 'position', 'positions', 'title', 'titles',
  'name', 'job name', 'occupation', 'profession', 'role', 'roles',
  'category', 'department', 'sector', 'description', 'notes', 'status',
  'المسمى الوظيفي', 'المسميات الوظيفية', 'الوظيفة', 'الوظائف', 'المهنة',
  'المنصب', 'القسم', 'التصنيف', 'القطاع', 'ملاحظات', 'الوصف', 'الحالة'
]);

/**
 * Cleans a candidate job title string
 */
function cleanCandidateTitle(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return null;
  let str = rawStr.trim();

  // Strip leading numbering, bullets, punctuation e.g. "1. ", "1- ", "- ", "• ", "* "
  str = str.replace(/^[\s\d\-.)(•*▪–—#]+/, '').trim();
  // Strip trailing punctuation e.g. ",", ";", "."
  str = str.replace(/[,;.:]+$/, '').trim();

  if (str.length < 2 || str.length > 120) return null;
  // If numeric only, skip
  if (/^\d+$/.test(str)) return null;

  // Reject PDF syntax tokens and binary garbage
  if (/^%%/.test(str)) return null; // %%EOF, %%Header etc.
  if (/^(endobj|endstream|stream|xref|trailer|startxref|obj)$/i.test(str)) return null;
  if (/^<<.*>>$/.test(str)) return null; // PDF dictionary tokens
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(str)) return null; // control chars / binary
  // Reject strings that are mostly non-printable or look like encoded data
  const nonPrintable = (str.match(/[^\x20-\x7E\u0600-\u06FF\u0750-\u077F]/g) || []).length;
  if (nonPrintable / str.length > 0.3) return null;
  // Reject if it looks like a PDF object reference e.g. "37 0 R" or hex strings
  if (/^\d+\s+\d+\s+R$/.test(str)) return null;
  if (/^[0-9A-Fa-f]{8,}$/.test(str)) return null;

  const norm = normalizeForComparison(str);
  if (JUNK_HEADERS.has(norm)) return null;

  return str;
}

/**
 * Extracts raw lines from an uploaded file buffer
 */
async function extractLinesFromFile(buffer, originalname, mimetype) {
  const ext = path.extname(originalname || '').toLowerCase();
  let rawText = '';

  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    // Lazy require to avoid serverless cold-start issues
    const xlsx = require('xlsx');
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const lines = [];
    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      rows.forEach((row) => {
        if (Array.isArray(row)) {
          row.forEach((cell) => {
            if (cell && typeof cell === 'string') {
              cell.split(/[\r\n]+/).forEach((sub) => {
                const cleaned = cleanCandidateTitle(sub);
                if (cleaned) lines.push(cleaned);
              });
            } else if (cell !== null && cell !== undefined && typeof cell !== 'object') {
              const cleaned = cleanCandidateTitle(String(cell));
              if (cleaned) lines.push(cleaned);
            }
          });
        }
      });
    });
    return lines;
  }

  if (ext === '.docx' || ext === '.doc') {
    try {
      const mammoth = require('mammoth');
      const docResult = await mammoth.extractRawText({ buffer });
      rawText = docResult.value || '';
    } catch (e) {
      console.warn('[Extraction] Mammoth error:', e.message);
      // Do NOT fall back to raw buffer — it produces binary garbage
      return [];
    }
  } else if (ext === '.pdf') {
    try {
      // Lazy require: pdf-parse runs file I/O at module load which crashes Vercel
      const pdfParse = require('pdf-parse');
      const pdfData = await pdfParse(buffer);
      rawText = pdfData.text || '';
    } catch (e) {
      console.warn('[Extraction] PDF-parse error:', e.message);
      // Do NOT fall back to raw buffer — it produces PDF syntax garbage
      return [];
    }
  } else {
    // .txt or default text
    rawText = buffer.toString('utf-8');
  }

  return parseLinesFromRawText(rawText);
}

/**
 * Parses lines from raw text string
 */
function parseLinesFromRawText(rawText) {
  if (!rawText) return [];
  const lines = [];
  // Split on newlines, semicolons, or commas (when appropriate)
  const segments = rawText.split(/[\r\n\t]+/);

  for (const seg of segments) {
    // If segment has multiple comma-separated items on a single line
    if (seg.includes(',') || seg.includes('،')) {
      const subItems = seg.split(/[,،]/);
      for (const item of subItems) {
        const cleaned = cleanCandidateTitle(item);
        if (cleaned) lines.push(cleaned);
      }
    } else {
      const cleaned = cleanCandidateTitle(seg);
      if (cleaned) lines.push(cleaned);
    }
  }
  return lines;
}

/**
 * Extracts and prepares titles for admin review before saving.
 * Checks for duplicates against the database and within the batch itself.
 */
async function extractTitlesForReview({ buffer, originalname, mimetype, rawText, defaultCategoryId }) {
  let rawTitles = [];

  if (buffer) {
    rawTitles = await extractLinesFromFile(buffer, originalname, mimetype);
  } else if (rawText) {
    rawTitles = parseLinesFromRawText(rawText);
  }

  if (rawTitles.length === 0) {
    return {
      totalFound: 0,
      uniqueCount: 0,
      duplicateCount: 0,
      items: []
    };
  }

  // Fetch all existing jobs from database for instant comparison
  const existingJobs = await Job.find({}).select('name nameAr categoryId').populate('categoryId', 'name nameAr').lean();

  const existingMap = new Map();
  for (const job of existingJobs) {
    if (job.name) existingMap.set(normalizeForComparison(job.name), job);
    if (job.nameAr) existingMap.set(normalizeForComparison(job.nameAr), job);
  }

  const seenInBatch = new Set();
  const items = [];
  let duplicateCount = 0;

  for (let i = 0; i < rawTitles.length; i++) {
    const title = rawTitles[i];
    const norm = normalizeForComparison(title);
    if (!norm) continue;

    const isArabic = /[\u0600-\u06FF]/.test(title);

    let isDuplicate = false;
    let duplicateReason = '';
    let matchedJob = null;

    if (existingMap.has(norm)) {
      isDuplicate = true;
      matchedJob = existingMap.get(norm);
      const catName = matchedJob.categoryId?.nameAr || matchedJob.categoryId?.name || '';
      duplicateReason = `موجود مسبقاً في قاعدة البيانات${catName ? ` ضمن تصنيف (${catName})` : ''}`;
      duplicateCount++;
    } else if (seenInBatch.has(norm)) {
      isDuplicate = true;
      duplicateReason = 'مكرر داخل نفس الملف / النص المرفوع';
      duplicateCount++;
    } else {
      seenInBatch.add(norm);
    }

    items.push({
      id: `item-${Date.now()}-${i}`,
      title,
      // As requested: keep job title as is (if entered in Arabic it stays Arabic, and so with English)
      name: title,
      nameAr: title,
      lang: isArabic ? 'ar' : 'en',
      categoryId: defaultCategoryId || '',
      isDuplicate,
      duplicateReason,
      selected: !isDuplicate // default selected only if not duplicate
    });
  }

  return {
    totalFound: rawTitles.length,
    uniqueCount: items.length - duplicateCount,
    duplicateCount,
    items
  };
}

/**
 * Processes a single job title as an independent, isolated process.
 * Ensures titles can NEVER be duplicated.
 */
async function processSingleTitle({ name, nameAr, categoryId, description }) {
  const cleanName = (name || nameAr || '').trim();
  const cleanNameAr = (nameAr || name || '').trim();

  if (!cleanName && !cleanNameAr) {
    throw new Error('Job title name is required');
  }

  if (!categoryId) {
    throw new Error('Category is required');
  }

  // Verify category exists
  const categoryExists = await JobCategory.findById(categoryId).lean();
  if (!categoryExists) {
    throw new Error(`Category not found: ${categoryId}`);
  }

  // Strict case-insensitive & normalized duplicate check in database
  const normName = normalizeForComparison(cleanName);
  const normNameAr = normalizeForComparison(cleanNameAr);

  const existingJobs = await Job.find({
    $or: [
      { name: new RegExp(`^${escapeRegex(cleanName)}$`, 'i') },
      { nameAr: new RegExp(`^${escapeRegex(cleanNameAr)}$`, 'i') }
    ]
  }).lean();

  if (existingJobs.length > 0) {
    const dup = existingJobs[0];
    throw new Error(`Duplicate title: '${dup.nameAr || dup.name}' already exists in system`);
  }

  // Create individual job record
  const job = await Job.create({
    name: cleanName,
    nameAr: cleanNameAr,
    categoryId,
    description: description || '',
    isActive: true
  });

  return job;
}

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

module.exports = {
  extractTitlesForReview,
  processSingleTitle,
  normalizeForComparison,
  // Reused by the persisted review-queue importer. These only parse input;
  // review records own validation, failure state, and lifecycle.
  parseLinesFromRawText,
  extractLinesFromFile
};
