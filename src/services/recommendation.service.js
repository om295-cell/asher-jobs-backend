const mongoose = require('mongoose');
const { RecommendationRequest, CAREER_LEVELS } = require('../models/RecommendationRequest');
const Candidate = require('../models/Candidate');
const User = require('../models/User');
const Job = require('../models/Job');
const { normalizeEgyptianPhone } = require('../utils/phoneNormalizer');

// Name regex: Letters and spaces only, at least one space (two words minimum)
const NAME_REGEX = /^[a-zA-Z\u0600-\u06FF]+(?:\s+[a-zA-Z\u0600-\u06FF]+)+$/;

// Egyptian Mobile Regex: 11 digits, starts with 010, 011, 012, or 015
const EGYPTIAN_PHONE_REGEX = /^01[0125][0-9]{8}$/;

/**
 * Validates a single full name string
 */
function validateFullName(name) {
  if (!name || typeof name !== 'string') {
    return { isValid: false, message: 'الاسم بالكامل مطلوب' };
  }
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 3) {
    return { isValid: false, message: 'الاسم يجب أن يتكون من 3 أحرف على الأقل' };
  }
  if (trimmed.length > 70) {
    return { isValid: false, message: 'الاسم طويل جداً (الحد الأقصى 70 حرف)' };
  }
  if (!NAME_REGEX.test(trimmed)) {
    return {
      isValid: false,
      message: 'الاسم يجب أن يحتوي على حروف فقط وبينهما مسافة واحدة على الأقل (اسم ثنائي أو أكثر)'
    };
  }
  return { isValid: true, sanitized: trimmed };
}

/**
 * Validates a single phone number string
 */
function validatePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, message: 'رقم الهاتف مطلوب' };
  }
  const digitsOnly = phone.trim().replace(/\D/g, '');
  if (!EGYPTIAN_PHONE_REGEX.test(digitsOnly)) {
    return {
      isValid: false,
      message: 'رقم الهاتف يجب أن يتكون من 11 رقماً ويبدأ بـ (010 أو 011 أو 012 أو 015)'
    };
  }
  const norm = normalizeEgyptianPhone(digitsOnly);
  if (!norm.isValid) {
    return { isValid: false, message: norm.error };
  }
  return { isValid: true, phone: digitsOnly, normalized: norm.normalized };
}

/**
 * Checks whether a single phone number already exists in DB
 */
async function checkPhoneAvailability(rawPhone) {
  const phoneValidation = validatePhoneNumber(rawPhone);
  if (!phoneValidation.isValid) {
    return {
      isAvailable: false,
      error: phoneValidation.message,
      phone: rawPhone
    };
  }

  const normalized = phoneValidation.normalized;

  // 1. Check Candidate collection
  const existingCandidate = await Candidate.findOne({
    phoneNormalized: normalized,
    isDeleted: false
  }).select('_id fullName').lean();

  if (existingCandidate) {
    return {
      isAvailable: false,
      existsIn: 'candidate',
      message: 'رقم الهاتف مسجل بالفعل في قاعدة بيانات المرشحين',
      phone: phoneValidation.phone
    };
  }

  // 2. Check User collection
  const existingUser = await User.findOne({
    phoneNormalized: normalized
  }).select('_id phone').lean();

  if (existingUser) {
    return {
      isAvailable: false,
      existsIn: 'user',
      message: 'رقم الهاتف مسجل بالفعل بحساب مستخدم',
      phone: phoneValidation.phone
    };
  }

  // 3. Check existing RecommendationRequests (pending or approved)
  const existingReq = await RecommendationRequest.findOne({
    status: { $in: ['pending', 'approved'] },
    'people.phoneNormalized': normalized
  }).select('requestNumber status').lean();

  if (existingReq) {
    return {
      isAvailable: false,
      existsIn: 'recommendation',
      message: `رقم الهاتف مسجل مسبقاً في طلب ترشيح (${existingReq.requestNumber})`,
      phone: phoneValidation.phone
    };
  }

  return {
    isAvailable: true,
    phone: phoneValidation.phone,
    normalized
  };
}

/**
 * Generates an unguessable unique request number (e.g., REC-849102)
 */
async function generateRequestNumber() {
  let attempts = 0;
  while (attempts < 10) {
    const randomDigits = Math.floor(100000 + Math.random() * 900000);
    const reqNum = `REC-${randomDigits}`;
    const exists = await RecommendationRequest.exists({ requestNumber: reqNum });
    if (!exists) return reqNum;
    attempts++;
  }
  // Fallback with timestamp
  return `REC-${Date.now().toString().slice(-6)}`;
}

/**
 * Submits a new group recommendation request (exactly 11 people)
 */
async function submitRecommendationRequest({ people, legalAccepted, ip = '', userAgent = '' }) {
  if (!legalAccepted) {
    throw {
      statusCode: 400,
      code: 'LEGAL_REQUIRED',
      message: 'يجب الموافقة والإقرار بالمسؤولية القانونية لتقديم الطلب.'
    };
  }

  if (!Array.isArray(people) || people.length !== 11) {
    throw {
      statusCode: 400,
      code: 'INVALID_PEOPLE_COUNT',
      message: 'يجب إدخال بيانات 11 شخصاً بالضبط (مقدم الطلب + 10 مرشحين موصى بهم).'
    };
  }

  const processedPeople = [];
  const validationErrors = {};
  const duplicateIndices = [];
  const duplicatePhones = [];

  // Track phones inside this request to detect intra-form duplicates
  const seenPhonesInForm = new Map();

  for (let i = 0; i < people.length; i++) {
    const person = people[i] || {};
    const personErrors = {};

    // 1. Validate Name
    const nameVal = validateFullName(person.fullName);
    if (!nameVal.isValid) {
      personErrors.fullName = nameVal.message;
    }

    // 2. Validate Phone Format
    const phoneVal = validatePhoneNumber(person.phone);
    if (!phoneVal.isValid) {
      personErrors.phone = phoneVal.message;
    } else {
      // Check intra-form duplicate
      if (seenPhonesInForm.has(phoneVal.normalized)) {
        const prevIndex = seenPhonesInForm.get(phoneVal.normalized);
        personErrors.phone = 'رقم الهاتف مكرر داخل نفس النموذج';
        duplicateIndices.push(i);
        duplicatePhones.push(phoneVal.phone);
        if (!duplicateIndices.includes(prevIndex)) {
          duplicateIndices.push(prevIndex);
        }
      } else {
        seenPhonesInForm.set(phoneVal.normalized, i);
      }
    }

    // 3. Validate Career Level
    if (!person.careerLevel || !CAREER_LEVELS.includes(person.careerLevel)) {
      personErrors.careerLevel = 'يرجى اختيار مستوى خبرة صحيح من القائمة المتاحة';
    }

    // 4. Validate Job ID
    if (!person.jobId || !mongoose.Types.ObjectId.isValid(person.jobId)) {
      personErrors.jobId = 'يرجى اختيار مسمى وظيفي معتمد من القائمة';
    }

    if (Object.keys(personErrors).length > 0) {
      validationErrors[i] = personErrors;
    } else {
      processedPeople.push({
        index: i,
        isPrimary: i === 0,
        role: i === 0 ? 'submitter' : 'recommendation',
        fullName: nameVal.sanitized,
        phone: phoneVal.phone,
        phoneNormalized: phoneVal.normalized,
        jobId: person.jobId,
        careerLevel: person.careerLevel
      });
    }
  }

  // If there are intra-form format or duplication errors
  if (Object.keys(validationErrors).length > 0) {
    throw {
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'يرجى مراجعة البيانات وتصحيح الأخطاء الموضحة أدناه.',
      errors: validationErrors,
      duplicateIndices
    };
  }

  // Check all 11 normalized phones against database
  const normalizedPhonesList = processedPeople.map(p => p.phoneNormalized);

  const [existingCandidates, existingUsers, existingRecommendations] = await Promise.all([
    Candidate.find({ phoneNormalized: { $in: normalizedPhonesList }, isDeleted: false }).select('phone phoneNormalized').lean(),
    User.find({ phoneNormalized: { $in: normalizedPhonesList } }).select('phone phoneNormalized').lean(),
    RecommendationRequest.find({
      status: { $in: ['pending', 'approved'] },
      'people.phoneNormalized': { $in: normalizedPhonesList }
    }).select('requestNumber people.phoneNormalized people.phone').lean()
  ]);

  const dbDuplicatePhonesSet = new Set();
  existingCandidates.forEach(c => dbDuplicatePhonesSet.add(c.phoneNormalized));
  existingUsers.forEach(u => dbDuplicatePhonesSet.add(u.phoneNormalized));
  existingRecommendations.forEach(r => {
    r.people?.forEach(p => {
      if (normalizedPhonesList.includes(p.phoneNormalized)) {
        dbDuplicatePhonesSet.add(p.phoneNormalized);
      }
    });
  });

  if (dbDuplicatePhonesSet.size > 0) {
    const dbDuplicateIndices = [];
    const dbDuplicatePhoneNumbers = [];

    processedPeople.forEach((p, idx) => {
      if (dbDuplicatePhonesSet.has(p.phoneNormalized)) {
        dbDuplicateIndices.push(idx);
        dbDuplicatePhoneNumbers.push(p.phone);
      }
    });

    throw {
      statusCode: 409,
      code: 'DUPLICATE_PHONE',
      message: 'توجد أرقام هواتف مسجلة مسبقاً في قاعدة البيانات. يُرجى استبدال الأرقام المحددة.',
      duplicateIndices: dbDuplicateIndices,
      duplicatePhones: dbDuplicatePhoneNumbers
    };
  }

  // Verify all jobIds exist and pull their titles
  const jobIds = processedPeople.map(p => p.jobId);
  const foundJobs = await Job.find({ _id: { $in: jobIds } }).lean();
  const jobMap = new Map();
  foundJobs.forEach(j => jobMap.set(j._id.toString(), j));

  for (const p of processedPeople) {
    const job = jobMap.get(p.jobId.toString());
    if (!job) {
      throw {
        statusCode: 400,
        code: 'JOB_NOT_FOUND',
        message: `الوظيفة المحددة للمرشح "${p.fullName}" غير موجودة في النظام.`
      };
    }
    p.jobTitle = job.name || '';
    p.jobTitleAr = job.nameAr || job.name || '';
  }

  // Generate unique request number
  const requestNumber = await generateRequestNumber();

  // Create request document
  const request = await RecommendationRequest.create({
    requestNumber,
    status: 'pending',
    legalAccepted: true,
    submitterIp: ip,
    submitterUserAgent: userAgent,
    people: processedPeople.map(({ index, ...rest }) => rest)
  });

  return {
    success: true,
    requestNumber: request.requestNumber,
    status: request.status,
    totalPeople: request.people.length,
    submitterName: request.people[0]?.fullName,
    createdAt: request.createdAt
  };
}

/**
 * Tracks status of a request by request number
 */
async function trackRequestStatus(requestNumber, primaryPhone = '') {
  if (!requestNumber || typeof requestNumber !== 'string') {
    throw { statusCode: 400, message: 'رقم الطلب مطلوب', code: 'REQUEST_NUMBER_REQUIRED' };
  }

  const cleanReqNum = requestNumber.trim().toUpperCase();

  const query = { requestNumber: cleanReqNum };
  const request = await RecommendationRequest.findOne(query).lean();

  if (!request) {
    throw {
      statusCode: 404,
      message: 'لم يتم العثور على طلب بهذا الرقم. تأكد من صحة رقم الطلب.',
      code: 'REQUEST_NOT_FOUND'
    };
  }

  const submitter = request.people[0] || {};

  // If primary phone is provided, verify it matches
  if (primaryPhone) {
    const norm = normalizeEgyptianPhone(primaryPhone.trim());
    if (norm.isValid && norm.normalized !== submitter.phoneNormalized) {
      throw {
        statusCode: 403,
        message: 'رقم الهاتف الأساسي غير متطابق مع بيانات الطلب.',
        code: 'PHONE_MISMATCH'
      };
    }
  }

  // Mask phone numbers for public tracking response (e.g. 010****5678)
  const maskedPeople = request.people.map(p => {
    const raw = p.phone || '';
    const masked = raw.length === 11 ? `${raw.slice(0, 3)}****${raw.slice(7)}` : raw;
    return {
      _id: p._id,
      fullName: p.fullName,
      maskedPhone: masked,
      jobTitle: p.jobTitleAr || p.jobTitle,
      careerLevel: p.careerLevel,
      isPrimary: p.isPrimary
    };
  });

  return {
    requestNumber: request.requestNumber,
    status: request.status,
    submitterName: submitter.fullName,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
    adminNotes: request.adminNotes || '',
    people: maskedPeople
  };
}

/**
 * Admin: List all recommendation requests
 */
async function adminListRequests({ page = 1, limit = 15, status = '', search = '' }) {
  const filter = {};
  if (status) {
    filter.status = status;
  }
  if (search) {
    const trimmed = search.trim();
    filter.$or = [
      { requestNumber: { $regex: trimmed, $options: 'i' } },
      { 'people.fullName': { $regex: trimmed, $options: 'i' } },
      { 'people.phone': { $regex: trimmed, $options: 'i' } }
    ];
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const pageLimit = parseInt(limit, 10);

  const [requests, total, counts] = await Promise.all([
    RecommendationRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageLimit)
      .lean(),
    RecommendationRequest.countDocuments(filter),
    RecommendationRequest.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ])
  ]);

  const statusCounts = { pending: 0, approved: 0, rejected: 0, total: 0 };
  counts.forEach(c => {
    if (statusCounts[c._id] !== undefined) {
      statusCounts[c._id] = c.count;
    }
    statusCounts.total += c.count;
  });

  return {
    requests,
    pagination: {
      page: parseInt(page, 10),
      limit: pageLimit,
      total,
      totalPages: Math.ceil(total / pageLimit)
    },
    statusCounts
  };
}

/**
 * Admin: Get single request details
 */
async function adminGetRequestById(id) {
  const request = await RecommendationRequest.findById(id).lean();
  if (!request) {
    throw { statusCode: 404, message: 'طلب الترشيح غير موجود', code: 'NOT_FOUND' };
  }
  return request;
}

/**
 * Admin: Update request status (approve or reject)
 */
async function adminUpdateRequestStatus(id, { status, adminNotes = '' }, adminUserId) {
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    throw { statusCode: 400, message: 'حالة غير صالحة', code: 'INVALID_STATUS' };
  }

  const request = await RecommendationRequest.findById(id);
  if (!request) {
    throw { statusCode: 404, message: 'طلب الترشيح غير موجود', code: 'NOT_FOUND' };
  }

  request.status = status;
  request.adminNotes = adminNotes;
  request.reviewedBy = adminUserId;
  request.reviewedAt = new Date();

  await request.save();

  return {
    success: true,
    requestNumber: request.requestNumber,
    status: request.status,
    adminNotes: request.adminNotes
  };
}

module.exports = {
  CAREER_LEVELS,
  validateFullName,
  validatePhoneNumber,
  checkPhoneAvailability,
  submitRecommendationRequest,
  trackRequestStatus,
  adminListRequests,
  adminGetRequestById,
  adminUpdateRequestStatus
};
