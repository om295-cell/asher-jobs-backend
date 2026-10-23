const xlsx = require('xlsx');
const Candidate = require('../models/Candidate');
const User = require('../models/User');
const Job = require('../models/Job');
const JobCategory = require('../models/JobCategory');
const { CAREER_LEVELS } = require('../models/RecommendationRequest');
const { normalizeEgyptianPhone } = require('../utils/phoneNormalizer');
const { normalizeForComparison } = require('./titleExtraction.service');
const { logActivity } = require('./activity.service');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { escapeRegex } = require('../middleware/sanitize.middleware');

// Standard Egyptian mobile regex (11 digits starting with 010, 011, 012, 015)
const EGYPTIAN_PHONE_REGEX = /^01[0125][0-9]{8}$/;

function cleanCandidateName(rawName) {
  if (!rawName || typeof rawName !== 'string') return '';
  return rawName.trim().replace(/\s+/g, ' ');
}

function cleanExcelPhone(val) {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  // Strip trailing decimals like .0 or .00
  str = str.replace(/\.0+$/, '');
  // If scientific notation e.g. 1.012345678e+9 or 1.012345678e+10
  if (/^\d+\.?\d*e\+\d+$/i.test(str)) {
    try {
      str = BigInt(Math.round(Number(str))).toString();
    } catch (e) {}
  }
  // Remove non-digit characters except leading plus
  str = str.replace(/[\s\-\(\)\.]/g, '');
  // If 10 digits starting with 1, Excel stripped the leading 0 -> prepend '0'
  if (/^1[0125]\d{8}$/.test(str)) {
    str = '0' + str;
  }
  return str;
}

function normalizeCareerLevel(rawLevel) {
  if (!rawLevel || typeof rawLevel !== 'string') return CAREER_LEVELS[1]; // Default to 'متوسط (3-5 سنوات)'
  const str = rawLevel.trim().toLowerCase();

  if (str.includes('مبتدئ') || str.includes('junior') || str.includes('entry') || str.includes('1-3') || str.includes('سنة') || str.includes('سنتين')) {
    return CAREER_LEVELS[0];
  }
  if (str.includes('متوسط') || str.includes('mid') || str.includes('3-5') || str.includes('4') || str.includes('3 سنوات')) {
    return CAREER_LEVELS[1];
  }
  if (str.includes('متقدم') || str.includes('senior') || str.includes('5-7') || str.includes('6 سنوات')) {
    return CAREER_LEVELS[2];
  }
  if (str.includes('كبير') || str.includes('خبير') || str.includes('lead') || str.includes('expert') || str.includes('7') || str.includes('أكثر')) {
    return CAREER_LEVELS[3];
  }

  // Exact match check
  const exact = CAREER_LEVELS.find((l) => l.toLowerCase() === str);
  if (exact) return exact;

  return CAREER_LEVELS[1];
}

function calculateExpYears(levelStr) {
  if (!levelStr) return 2;
  if (levelStr.includes('7') || levelStr.includes('كبير')) return 8;
  if (levelStr.includes('5') || levelStr.includes('متقدم')) return 6;
  if (levelStr.includes('3') || levelStr.includes('متوسط')) return 4;
  return 2;
}

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let rand = '';
  for (let i = 0; i < 4; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `ASH-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

/**
 * Extracts and analyzes candidate rows from an Excel or CSV file buffer
 */
async function extractCandidatesFromExcel({ buffer, originalname, mimetype, defaultCategoryId }) {
  if (!buffer) {
    throw { statusCode: 400, message: 'ملف الإكسيل مطلوب للاستخراج' };
  }

  const workbook = xlsx.read(buffer, { type: 'buffer', codepage: 65001, cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw { statusCode: 400, message: 'الملف المرفوع لا يحتوي على أي أوراق عمل (Sheets)' };
  }

  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) {
    throw { statusCode: 400, message: 'تعذر قراءة ورقة العمل من الملف المرفوع' };
  }

  // Recalculate sheet['!ref'] dynamically to guarantee that sheet_to_json does not truncate at 40-50 rows
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    try {
      const decoded = xlsx.utils.decode_cell(key);
      if (decoded.r < minR) minR = decoded.r;
      if (decoded.r > maxR) maxR = decoded.r;
      if (decoded.c < minC) minC = decoded.c;
      if (decoded.c > maxC) maxC = decoded.c;
    } catch (e) {}
  }
  if (maxR >= 0 && maxC >= 0) {
    sheet['!ref'] = xlsx.utils.encode_range({
      s: { r: Math.min(minR, 0), c: Math.min(minC, 0) },
      e: { r: maxR, c: maxC }
    });
  }

  const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });

  if (!rawRows || rawRows.length < 2) {
    throw { statusCode: 400, message: 'الملف المرفوع فارغ أو لا يحتوي على صفوف بيانات كافية' };
  }

  // Identify header indices
  let nameCol = -1;
  let phoneCol = -1;
  let jobCol = -1;
  let levelCol = -1;
  let headerRowIndex = 0;

  // Search first 10 rows for header keywords
  for (let r = 0; r < Math.min(10, rawRows.length); r++) {
    const row = rawRows[r];
    if (!Array.isArray(row)) continue;

    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || '').trim().toLowerCase();
      if (!cell) continue;

      if (nameCol === -1 && (
        cell.includes('اسم') || cell.includes('مرشح') || cell.includes('name') || cell.includes('person')
      )) {
        nameCol = c;
      }
      if (phoneCol === -1 && (
        cell.includes('هاتف') || cell.includes('موبايل') || cell.includes('تليفون') || cell.includes('جوال') ||
        cell.includes('phone') || cell.includes('mobile') || cell.includes('tel') || cell.includes('cell')
      )) {
        phoneCol = c;
      }
      if (jobCol === -1 && (
        cell.includes('وظيفة') || cell.includes('مسمى') || cell.includes('مهنة') || cell.includes('تخصص') ||
        cell.includes('job') || cell.includes('title') || cell.includes('position') || cell.includes('role')
      )) {
        jobCol = c;
      }
      if (levelCol === -1 && (
        cell.includes('مستوى') || cell.includes('خبرة') || cell.includes('level') || cell.includes('experience')
      )) {
        levelCol = c;
      }
    }

    if (nameCol !== -1 && phoneCol !== -1) {
      headerRowIndex = r;
      break;
    }
  }

  // Fallbacks if not detected by header text
  if (nameCol === -1) nameCol = 0;
  if (phoneCol === -1) phoneCol = 1;
  if (jobCol === -1) jobCol = 2;
  if (levelCol === -1 && rawRows[0]?.length > 3) levelCol = 3;

  // Pre-load reference catalogs for fast evaluation
  const [existingJobs, existingCandidates, existingCategories] = await Promise.all([
    Job.find({}).populate('categoryId', 'name nameAr').lean(),
    Candidate.find({ isDeleted: false }, 'fullName phone phoneNormalized desiredJobId careerLevel')
      .populate('desiredJobId', 'name nameAr')
      .lean(),
    JobCategory.find({}).lean()
  ]);

  // Build Job lookup Map by normalized title
  const jobMap = new Map();
  for (const job of existingJobs) {
    if (job.name) jobMap.set(normalizeForComparison(job.name), job);
    if (job.nameAr) jobMap.set(normalizeForComparison(job.nameAr), job);
  }

  // Build Candidate lookup Map by phone and phoneNormalized
  const candidatePhoneMap = new Map();
  for (const cand of existingCandidates) {
    if (cand.phoneNormalized) candidatePhoneMap.set(cand.phoneNormalized, cand);
    if (cand.phone) candidatePhoneMap.set(cand.phone, cand);
  }

  // Categories default fallback
  const fallbackCategory = existingCategories.find((c) => c._id.toString() === String(defaultCategoryId)) ||
    existingCategories.find((c) => c.name === 'Uncategorized' || c.nameAr === 'غير مصنف') ||
    existingCategories[0];

  const items = [];
  const seenPhonesInBatch = new Set();
  let phoneConflictCount = 0;
  let newTitlesCount = 0;
  let existingTitlesCount = 0;

  for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
    try {
      const row = rawRows[r];
      if (!Array.isArray(row) || row.length === 0) continue;

      const rawName = String(row[nameCol] !== undefined ? row[nameCol] : '').trim();
      const rawPhoneRaw = row[phoneCol] !== undefined ? row[phoneCol] : '';
      const cleanedPhone = cleanExcelPhone(rawPhoneRaw);
      const rawJob = jobCol !== -1 && row[jobCol] !== undefined ? String(row[jobCol]).trim() : '';
      const rawLevel = levelCol !== -1 && row[levelCol] !== undefined ? String(row[levelCol]).trim() : '';

      // Skip empty rows
      if (!rawName && !cleanedPhone && !rawJob) continue;

      const name = cleanCandidateName(rawName);
      const careerLevel = normalizeCareerLevel(rawLevel);

      // Validate and normalize phone
      let phone = cleanedPhone;
      let phoneNormalized = '';
      let isPhoneValid = false;
      let phoneError = '';

      const phoneCheck = normalizeEgyptianPhone(phone);
      if (phoneCheck.isValid) {
        isPhoneValid = true;
        phone = phoneCheck.local;
        phoneNormalized = phoneCheck.normalized;
      } else {
        phoneError = phoneCheck.error || 'رقم هاتف غير صالح';
      }

      // Check Duplicate Phone in Database (Requirement 2)
      let phoneExists = false;
      let existingCandidate = null;
      let replaceChoice = 'replace'; // Default choice for admin

      if (isPhoneValid) {
        if (candidatePhoneMap.has(phoneNormalized) || candidatePhoneMap.has(phone)) {
          phoneExists = true;
          const matchedCand = candidatePhoneMap.get(phoneNormalized) || candidatePhoneMap.get(phone);
          existingCandidate = {
            id: matchedCand._id,
            fullName: matchedCand.fullName,
            phone: matchedCand.phone,
            currentJobTitle: matchedCand.desiredJobId?.nameAr || matchedCand.desiredJobId?.name || 'غير محدد',
            careerLevel: matchedCand.careerLevel || 'غير محدد'
          };
          phoneConflictCount++;
        } else if (seenPhonesInBatch.has(phoneNormalized)) {
          phoneError = 'مكرر داخل نفس ملف الإكسيل المرفوع';
          isPhoneValid = false;
        } else {
          seenPhonesInBatch.add(phoneNormalized);
        }
      }

      // Check Job Title in Database (Requirement 3)
      const normJob = normalizeForComparison(rawJob);
      let titleExists = false;
      let matchedJob = null;
      let suggestedCategoryId = fallbackCategory ? fallbackCategory._id.toString() : '';
      let suggestedCategoryName = fallbackCategory ? (fallbackCategory.nameAr || fallbackCategory.name) : '';

      if (normJob && jobMap.has(normJob)) {
        titleExists = true;
        const jobDoc = jobMap.get(normJob);
        matchedJob = {
          id: jobDoc._id,
          name: jobDoc.name,
          nameAr: jobDoc.nameAr,
          categoryId: jobDoc.categoryId?._id || jobDoc.categoryId,
          categoryName: jobDoc.categoryId?.nameAr || jobDoc.categoryId?.name || ''
        };
        suggestedCategoryId = jobDoc.categoryId?._id?.toString() || jobDoc.categoryId?.toString() || suggestedCategoryId;
        suggestedCategoryName = jobDoc.categoryId?.nameAr || jobDoc.categoryId?.name || suggestedCategoryName;
        existingTitlesCount++;
      } else {
        titleExists = false;
        if (rawJob) {
          newTitlesCount++;
        }
      }

      items.push({
        id: `cand-${Date.now()}-${r}`,
        rowIndex: r + 1,
        name: name || rawName,
        phone: phone || String(rawPhoneRaw || '').trim(),
        phoneNormalized,
        isPhoneValid,
        phoneError,
        phoneExists,
        existingCandidate,
        replaceChoice, // 'replace' | 'skip'
        rawJobTitle: rawJob,
        jobTitle: rawJob,
        titleExists,
        matchedJob,
        approveNewTitle: !titleExists && !!rawJob, // Admin approval flag
        categoryId: suggestedCategoryId,
        categoryName: suggestedCategoryName,
        careerLevel,
        includeInImport: isPhoneValid && !!name // Checked by default if valid
      });
    } catch (rowError) {
      console.warn(`[Candidate Extract] Error parsing row ${r + 1}:`, rowError.message);
    }
  }

  return {
    totalRows: items.length,
    validRowsCount: items.filter((i) => i.isPhoneValid && i.name).length,
    phoneConflictCount,
    newTitlesCount,
    existingTitlesCount,
    defaultCategoryId: fallbackCategory ? fallbackCategory._id : null,
    items
  };
}

/**
 * Searches candidates by name or phone for designating as the Main Candidate
 */
async function searchCandidatesForMain({ search = '', limit = 10 }) {
  const query = { isDeleted: false };
  if (search && search.trim()) {
    const s = escapeRegex(search.trim());
    query.$or = [
      { fullName: { $regex: s, $options: 'i' } },
      { phone: { $regex: s, $options: 'i' } },
      { phoneNormalized: { $regex: s, $options: 'i' } }
    ];
  }

  const candidates = await Candidate.find(query)
    .populate('desiredJobId', 'name nameAr')
    .populate('categoryId', 'name nameAr')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return candidates.map((c) => ({
    id: c._id,
    fullName: c.fullName,
    phone: c.phone,
    jobTitle: c.desiredJobId?.nameAr || c.desiredJobId?.name || 'غير محدد',
    careerLevel: c.careerLevel || '',
    categoryName: c.categoryId?.nameAr || c.categoryId?.name || '',
    referralCount: c.referralCount || 0
  }));
}

/**
 * Executes the candidate batch import with approval handling for Job titles,
 * Phone conflict replacement, and linking under the Main Candidate as recommendations.
 */
async function executeCandidateImport({ items, mainCandidate, adminUserId }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw { statusCode: 400, message: 'لا توجد بيانات مرشحين للاستيراد' };
  }

  if (!mainCandidate) {
    throw { statusCode: 400, message: 'يجب اختيار أو إضافة مرشح رئيسي لتسجيل التوصيات تحته' };
  }

  // 1. Resolve or Create Main Candidate (Requirement 1)
  let mainCandidateDoc = null;

  if (mainCandidate.mode === 'existing') {
    if (!mainCandidate.candidateId) {
      throw { statusCode: 400, message: 'يرجى اختيار المرشح الرئيسي المسجل' };
    }
    mainCandidateDoc = await Candidate.findById(mainCandidate.candidateId);
    if (!mainCandidateDoc) {
      throw { statusCode: 404, message: 'تعذر العثور على المرشح الرئيسي المختار' };
    }
  } else if (mainCandidate.mode === 'new') {
    const { fullName, phone, jobTitle, careerLevel, categoryId } = mainCandidate;
    if (!fullName || !phone || !jobTitle) {
      throw { statusCode: 400, message: 'بيانات المرشح الرئيسي الجديد غير مكتملة (الاسم، الهاتف، المسمى الوظيفي)' };
    }

    const phoneCheck = normalizeEgyptianPhone(phone);
    if (!phoneCheck.isValid) {
      throw { statusCode: 400, message: phoneCheck.error || 'رقم هاتف المرشح الرئيسي غير صالح' };
    }

    // Check if main candidate already exists by phone
    mainCandidateDoc = await Candidate.findOne({ phoneNormalized: phoneCheck.normalized });

    if (!mainCandidateDoc) {
      // Find or create Job for main candidate
      let job = await Job.findOne({
        $or: [
          { name: jobTitle },
          { nameAr: jobTitle }
        ]
      });

      if (!job) {
        let mainCatId = categoryId;
        if (!mainCatId) {
          let fallbackCat = await JobCategory.findOne({});
          if (!fallbackCat) {
            fallbackCat = await JobCategory.create({ name: 'General', nameAr: 'عام' });
          }
          mainCatId = fallbackCat._id;
        }

        job = await Job.create({
          name: jobTitle,
          nameAr: jobTitle,
          categoryId: mainCatId,
          isActive: true
        });
      }

      // Find or create User for main candidate
      let user = await User.findOne({ phoneNormalized: phoneCheck.normalized });
      if (!user) {
        const tempPassword = crypto.randomBytes(8).toString('hex');
        const passwordHash = await bcrypt.hash(tempPassword, 10);
        user = await User.create({
          phone: phoneCheck.local,
          phoneNormalized: phoneCheck.normalized,
          passwordHash,
          role: 'candidate',
          accountStatus: 'active'
        });
      }

      const referralCode = generateReferralCode();

      mainCandidateDoc = await Candidate.create({
        userId: user._id,
        fullName: cleanCandidateName(fullName),
        phone: phoneCheck.local,
        phoneNormalized: phoneCheck.normalized,
        desiredJobId: job._id,
        careerLevel: careerLevel || CAREER_LEVELS[1],
        desiredJobs: [
          { jobId: job._id, jobTitle: job.name, jobTitleAr: job.nameAr, careerLevel: careerLevel || CAREER_LEVELS[1], priority: 1 }
        ],
        categoryId: job.categoryId,
        governorate: 'Sharqia',
        area: '10th of Ramadan',
        yearsOfExperience: calculateExpYears(careerLevel),
        qualification: 'Technical Diploma',
        skills: [jobTitle],
        availabilityStatus: 'Available',
        accountStatus: 'active',
        consentGiven: true,
        consentDate: new Date(),
        referralCode,
        isRecommendation: false,
        adminNotes: `تم إنشاؤه كمرشح رئيسي عبر استيراد إكسيل بتاريخ ${new Date().toLocaleDateString('ar-EG')}`
      });
    }
  }

  // 2. Pre-process and Create New Approved Job Titles (Requirement 3)
  const allJobs = await Job.find({}).lean();
  const jobByIdMap = new Map();
  const jobTitleMap = new Map();

  for (const j of allJobs) {
    jobByIdMap.set(String(j._id), j);
    if (j.name) jobTitleMap.set(normalizeForComparison(j.name), j);
    if (j.nameAr) jobTitleMap.set(normalizeForComparison(j.nameAr), j);
  }

  let newJobsCreatedCount = 0;

  for (const item of items) {
    if (!item.includeInImport) continue;
    const title = (item.jobTitle || item.rawJobTitle || '').trim();
    if (!title) continue;

    const norm = normalizeForComparison(title);
    if (!item.jobId && !jobTitleMap.has(norm) && item.approveNewTitle) {
      try {
        let catId = item.categoryId;
        if (!catId) {
          let fallbackCat = await JobCategory.findOne({});
          if (!fallbackCat) {
            fallbackCat = await JobCategory.create({ name: 'General', nameAr: 'عام' });
          }
          catId = fallbackCat._id;
        }

        const newJob = await Job.create({
          name: title,
          nameAr: title,
          categoryId: catId,
          isActive: true
        });

        const newJobLean = newJob.toObject ? newJob.toObject() : newJob;
        jobByIdMap.set(String(newJob._id), newJobLean);
        jobTitleMap.set(norm, newJobLean);
        newJobsCreatedCount++;
      } catch (err) {
        console.warn(`[Candidate Import] Title creation error for "${title}":`, err.message);
      }
    }
  }

  // 3. Batch Pre-fetch all Existing Candidates and Users to eliminate roundtrips
  const includedItems = items.filter((i) => i.includeInImport);
  const normalizedPhones = [];
  const localPhones = [];
  for (const it of includedItems) {
    const pCheck = normalizeEgyptianPhone(it.phone);
    if (pCheck.isValid) {
      normalizedPhones.push(pCheck.normalized);
      localPhones.push(pCheck.local);
    }
  }

  const [existingCandidateDocs, existingUserDocs] = await Promise.all([
    Candidate.find({
      $or: [
        { phoneNormalized: { $in: normalizedPhones } },
        { phone: { $in: localPhones } }
      ]
    }),
    User.find({
      $or: [
        { phoneNormalized: { $in: normalizedPhones } },
        { phone: { $in: localPhones } }
      ]
    })
  ]);

  const candidateByPhoneMap = new Map();
  for (const c of existingCandidateDocs) {
    if (c.phoneNormalized) candidateByPhoneMap.set(c.phoneNormalized, c);
    if (c.phone) candidateByPhoneMap.set(c.phone, c);
  }

  const userByPhoneMap = new Map();
  for (const u of existingUserDocs) {
    if (u.phoneNormalized) userByPhoneMap.set(u.phoneNormalized, u);
    if (u.phone) userByPhoneMap.set(u.phone, u);
  }

  // Pre-generate shared password hash ONCE to prevent CPU blocking on large batches
  const sharedPasswordHash = await bcrypt.hash('AsherCandidate@' + crypto.randomBytes(4).toString('hex'), 10);

  // 4. Process candidate rows (Requirement 2 & Requirement 1)
  let createdCount = 0;
  let replacedCount = 0;
  let skippedCount = 0;
  const errors = [];

  for (const item of items) {
    if (!item.includeInImport) {
      skippedCount++;
      continue;
    }

    try {
      const phoneCheck = normalizeEgyptianPhone(item.phone);
      if (!phoneCheck.isValid) {
        errors.push({ name: item.name, phone: item.phone, error: phoneCheck.error });
        continue;
      }

      // Resolve Job: Prefer explicitly selected system jobId, fallback to normalized title match
      let matchedJob = null;
      if (item.jobId && jobByIdMap.has(String(item.jobId))) {
        matchedJob = jobByIdMap.get(String(item.jobId));
      }
      if (!matchedJob) {
        const normTitle = normalizeForComparison(item.jobTitle || item.rawJobTitle);
        matchedJob = jobTitleMap.get(normTitle) || allJobs[0];
      }
      const jobId = matchedJob?._id;
      const jobCategory = matchedJob?.categoryId?._id || matchedJob?.categoryId;
      const careerLevel = normalizeCareerLevel(item.careerLevel);
      const expYears = calculateExpYears(careerLevel);

      // Check if candidate exists by phone in in-memory map
      const existingCandidate = candidateByPhoneMap.get(phoneCheck.normalized) || candidateByPhoneMap.get(phoneCheck.local);

      if (existingCandidate) {
        // Requirement 2: Admin choice for phone conflict
        if (item.replaceChoice === 'skip') {
          skippedCount++;
          continue;
        }

        // Admin chose 'replace': Update existing candidate record
        existingCandidate.fullName = cleanCandidateName(item.name);
        existingCandidate.desiredJobId = jobId;
        existingCandidate.careerLevel = careerLevel;
        existingCandidate.categoryId = jobCategory;
        existingCandidate.yearsOfExperience = expYears;
        existingCandidate.desiredJobs = [
          {
            jobId,
            jobTitle: matchedJob?.name || item.jobTitle,
            jobTitleAr: matchedJob?.nameAr || item.jobTitle,
            careerLevel,
            priority: 1
          }
        ];
        // Link under main candidate as recommendation
        existingCandidate.isRecommendation = true;
        existingCandidate.invitedBy = mainCandidateDoc._id;
        existingCandidate.referredByName = mainCandidateDoc.fullName;
        existingCandidate.referredByPhone = mainCandidateDoc.phone;
        existingCandidate.chainParentCandidateId = mainCandidateDoc._id;
        existingCandidate.adminNotes = `${existingCandidate.adminNotes || ''}\n[استيراد إكسيل]: تم تحديث البيانات وربطه كتوصية تحت (${mainCandidateDoc.fullName} - ${mainCandidateDoc.phone}) بتاريخ ${new Date().toLocaleDateString('ar-EG')}`;

        await existingCandidate.save();
        replacedCount++;
      } else {
        // Find or create User
        let user = userByPhoneMap.get(phoneCheck.normalized) || userByPhoneMap.get(phoneCheck.local);
        if (!user) {
          user = await User.create({
            phone: phoneCheck.local,
            phoneNormalized: phoneCheck.normalized,
            passwordHash: sharedPasswordHash,
            role: 'candidate',
            accountStatus: 'active'
          });
          userByPhoneMap.set(phoneCheck.normalized, user);
          userByPhoneMap.set(phoneCheck.local, user);
        }

        const referralCode = generateReferralCode();

        // Create new Candidate linked under main candidate
        const newCandidateDoc = await Candidate.create({
          userId: user._id,
          fullName: cleanCandidateName(item.name),
          phone: phoneCheck.local,
          phoneNormalized: phoneCheck.normalized,
          desiredJobId: jobId,
          careerLevel,
          categoryId: jobCategory,
          desiredJobs: [
            {
              jobId,
              jobTitle: matchedJob?.name || item.jobTitle,
              jobTitleAr: matchedJob?.nameAr || item.jobTitle,
              careerLevel,
              priority: 1
            }
          ],
          governorate: 'Sharqia',
          area: '10th of Ramadan',
          yearsOfExperience: expYears,
          qualification: 'Technical Diploma',
          skills: [item.jobTitle || 'Industrial'],
          availabilityStatus: 'Available',
          accountStatus: 'active',
          consentGiven: true,
          consentDate: new Date(),
          referralCode,
          isRecommendation: true,
          invitedBy: mainCandidateDoc._id,
          referredByName: mainCandidateDoc.fullName,
          referredByPhone: mainCandidateDoc.phone,
          chainParentCandidateId: mainCandidateDoc._id,
          adminNotes: `تم استيراده عبر إكسيل كتوصية تحت المرشح الرئيسي (${mainCandidateDoc.fullName} - ${mainCandidateDoc.phone})`
        });

        candidateByPhoneMap.set(phoneCheck.normalized, newCandidateDoc);
        candidateByPhoneMap.set(phoneCheck.local, newCandidateDoc);
        createdCount++;
      }
    } catch (rowErr) {
      console.error(`[Candidate Import] Error processing row for ${item.name}:`, rowErr.message);
      errors.push({ name: item.name, phone: item.phone, error: rowErr.message });
    }
  }

  // 5. Update Main Candidate Referral Count
  const totalLinked = createdCount + replacedCount;
  if (totalLinked > 0) {
    mainCandidateDoc.referralCount = (mainCandidateDoc.referralCount || 0) + totalLinked;
    await mainCandidateDoc.save();
  }

  // 6. Log Activity
  await logActivity({
    actorId: adminUserId,
    actorRole: 'admin',
    action: 'CANDIDATE_EXCEL_IMPORT',
    entityType: 'Candidate',
    entityId: mainCandidateDoc._id,
    metadata: {
      mainCandidate: { id: mainCandidateDoc._id, fullName: mainCandidateDoc.fullName, phone: mainCandidateDoc.phone },
      totalItems: items.length,
      createdCount,
      replacedCount,
      skippedCount,
      newJobsCreatedCount,
      errorsCount: errors.length
    }
  });

  return {
    success: true,
    mainCandidate: {
      id: mainCandidateDoc._id,
      fullName: mainCandidateDoc.fullName,
      phone: mainCandidateDoc.phone
    },
    totalProcessed: items.length,
    createdCount,
    replacedCount,
    skippedCount,
    newJobsCreatedCount,
    errors
  };
}

module.exports = {
  extractCandidatesFromExcel,
  searchCandidatesForMain,
  executeCandidateImport
};
