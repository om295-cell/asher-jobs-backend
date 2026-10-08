const path = require('path');
const Job = require('../models/Job');
const JobCategory = require('../models/JobCategory');

function normalizeForComparison(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[^\w\s\u0600-\u06FF]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const JUNK_HEADERS = new Set([
  'job title', 'job titles', 'position', 'positions', 'title', 'titles',
  'name', 'job name', 'occupation', 'profession', 'role', 'roles',
  'category', 'department', 'sector', 'description', 'notes', 'status',
  'المسمى الوظيفي', 'المسميات الوظيفية', 'الوظيفة', 'الوظائف', 'المهنة',
  'المنصب', 'القسم', 'التصنيف', 'القطاع', 'ملاحظات', 'الوصف', 'الحالة'
]);

function cleanCandidateTitle(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return null;
  let str = rawStr.trim();

  // Strip leading numbering/bullets e.g. "1. ", "1- ", "- ", "• "
  str = str.replace(/^[\s\d\-.)(•*▪–—#]+/, '').trim();
  // Strip trailing punctuation
  str = str.replace(/[,;.:]+$/, '').trim();

  if (str.length < 2 || str.length > 120) return null;
  if (/^\d+$/.test(str)) return null;

  // PDF syntax tokens
  if (/^%%/.test(str)) return null;
  if (/^(endobj|endstream|stream|xref|trailer|startxref|obj)$/i.test(str)) return null;
  if (/^<<.*>>/.test(str)) return null;
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(str)) return null;

  // Non-printable ratio
  const nonPrintable = (str.match(/[^\x20-\x7E\u0600-\u06FF\u0750-\u077F\u200C-\u200F]/g) || []).length;
  if (nonPrintable / str.length > 0.25) return null;

  // Must have at least one Arabic or Latin letter
  if (!/[a-zA-Z\u0600-\u06FF]/.test(str)) return null;

  // Reject random/encoded strings (no Arabic, no spaces)
  if (!/[\u0600-\u06FF\s]/.test(str)) {
    if (/^[A-Z0-9+/=_\-]{6,}$/.test(str)) return null;
    const letters = str.replace(/[^a-zA-Z]/g, '');
    const vowels = str.replace(/[^aeiouAEIOU]/g, '');
    if (letters.length >= 4 && vowels.length === 0) return null;
    if (/\d/.test(str) && !/\s/.test(str) && str.length <= 20) return null;
  }

  // Certificate DN garbage: e.g. "San Francisco10U", "UUS1 0", "LLC1 0"
  if (/\d+[A-Z]$/.test(str)) return null;
  if (/^[A-Z]{2,}\d+/.test(str)) return null;
  if (/\b[A-Z]{2,}\d+\s+\d+$/.test(str)) return null;

  // PDF object reference e.g. "37 0 R"
  if (/^\d+\s+\d+\s+R$/.test(str)) return null;

  const norm = normalizeForComparison(str);
  if (JUNK_HEADERS.has(norm)) return null;

  return str;
}

function parseLinesFromRawText(rawText) {
  if (!rawText) return [];
  const lines = [];

  // Pre-split inline numbered lists e.g. "محاسب مالي 2. محاسب تكاليف 3. مراجع حسابات"
  // Replace " 2. " / " 10. " / " 2- " patterns with newline
  const normalized = rawText.replace(/(\s)\d{1,3}[.)\-]\s+/g, '\n');

  const segments = normalized.split(/[\r\n]+/);

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    const hasArabic = /[\u0600-\u06FF]/.test(trimmed);

    if (!hasArabic && (trimmed.includes(',') || trimmed.includes('\t'))) {
      trimmed.split(/[,\t]/).forEach((item) => {
        const cleaned = cleanCandidateTitle(item);
        if (cleaned) lines.push(cleaned);
      });
    } else if (trimmed.includes('\u060c')) {
      // Arabic comma
      trimmed.split('\u060c').forEach((item) => {
        const cleaned = cleanCandidateTitle(item);
        if (cleaned) lines.push(cleaned);
      });
    } else {
      const cleaned = cleanCandidateTitle(trimmed);
      if (cleaned) lines.push(cleaned);
    }
  }
  return lines;
}

async function extractLinesFromFile(buffer, originalname, mimetype) {
  const ext = path.extname(originalname || '').toLowerCase();
  let rawText = '';

  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    const xlsx = require('xlsx');

    if (ext === '.csv') {
      // xlsx misreads UTF-8 Arabic — parse as plain UTF-8 text
      const text = buffer.toString('utf-8');
      const csvLines = [];
      text.split(/[\r\n]+/).forEach((line) => {
        if (!line.trim()) return;
        line.split(',').forEach((cell) => {
          const cleaned = cleanCandidateTitle(cell);
          if (cleaned) csvLines.push(cleaned);
        });
      });
      return csvLines;
    }

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
      return [];
    }
  } else if (ext === '.pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const pdfData = await pdfParse(buffer);
      rawText = pdfData.text || '';
    } catch (e) {
      console.warn('[Extraction] PDF-parse error:', e.message);
      return [];
    }
  } else {
    rawText = buffer.toString('utf-8');
  }

  return parseLinesFromRawText(rawText);
}

async function extractTitlesForReview({ buffer, originalname, mimetype, rawText, defaultCategoryId }) {
  let rawTitles = [];
  if (buffer) {
    rawTitles = await extractLinesFromFile(buffer, originalname, mimetype);
  } else if (rawText) {
    rawTitles = parseLinesFromRawText(rawText);
  }
  if (rawTitles.length === 0) return { totalFound: 0, uniqueCount: 0, duplicateCount: 0, items: [] };

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
      title, name: title, nameAr: title,
      lang: isArabic ? 'ar' : 'en',
      categoryId: defaultCategoryId || '',
      isDuplicate, duplicateReason,
      selected: !isDuplicate
    });
  }

  return { totalFound: rawTitles.length, uniqueCount: items.length - duplicateCount, duplicateCount, items };
}

async function processSingleTitle({ name, nameAr, categoryId, description }) {
  const cleanName = (name || nameAr || '').trim();
  const cleanNameAr = (nameAr || name || '').trim();
  if (!cleanName && !cleanNameAr) throw new Error('Job title name is required');
  if (!categoryId) throw new Error('Category is required');
  const categoryExists = await JobCategory.findById(categoryId).lean();
  if (!categoryExists) throw new Error(`Category not found: ${categoryId}`);

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

  return Job.create({ name: cleanName, nameAr: cleanNameAr, categoryId, description: description || '', isActive: true });
}

function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

module.exports = {
  extractTitlesForReview,
  processSingleTitle,
  normalizeForComparison,
  parseLinesFromRawText,
  extractLinesFromFile
};
