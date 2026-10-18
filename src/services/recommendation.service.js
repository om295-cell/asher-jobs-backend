const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { RecommendationRequest, CAREER_LEVELS } = require('../models/RecommendationRequest');
const Candidate = require('../models/Candidate');
const User = require('../models/User');
const Job = require('../models/Job');
const AdminNotification = require('../models/AdminNotification');
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
    return { isValid: false, message: 'الاسم طويل جداً (الحد الأقصى 70 حرفاً)' };
  }
  if (!NAME_REGEX.test(trimmed)) {
    return { isValid: false, message: 'يرجى إدخال الاسم ثنائياً على الأقل بحروف فقط بدون أرقام أو رموز' };
  }
  return { isValid: true, sanitized: trimmed };
}

/**
 * Helper to determine if two names represent substantially different identities
 */
function areNamesSubstantiallyDifferent(name1, name2) {
  if (!name1 || !name2) return false;
  const clean = (str) =>
    String(str)
      .trim()
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[\u064B-\u065F]/g, '') // tashkeel
      .replace(/\s+/g, ' ');

  const c1 = clean(name1);
  const c2 = clean(name2);
  if (c1 === c2) return false;

  // Compare first two words
  const words1 = c1.split(' ').slice(0, 2).join(' ');
  const words2 = c2.split(' ').slice(0, 2).join(' ');
  return words1 !== words2;
}

/**
 * Validates a single Egyptian phone number
 */
function validatePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, message: 'رقم الهاتف مطلوب' };
  }
  const digitsOnly = phone.trim().replace(/\s+/g, '');
  if (!EGYPTIAN_PHONE_REGEX.test(digitsOnly)) {
    return { isValid: false, message: 'رقم الموبايل غير صحيح. يجب أن يتكون من 11 رقماً ويبدأ بـ 010 أو 011 أو 012 أو 015' };
  }
  const norm = normalizeEgyptianPhone(digitsOnly);
  if (!norm.isValid) {
    return { isValid: false, message: norm.error };
  }
  return { isValid: true, phone: digitsOnly, normalized: norm.normalized };
}

/**
 * Checks whether a single phone number already exists in DB with support for
 * chain linking and different-name phone conflicts.
 */
async function checkPhoneAvailability(rawPhone, isPrimary = false, currentName = '') {
  const phoneValidation = validatePhoneNumber(rawPhone);
  if (!phoneValidation.isValid) {
    return {
      isAvailable: false,
      error: phoneValidation.message,
      phone: rawPhone
    };
  }

  const normalized = phoneValidation.normalized;

  // For primary submitters, check for Chain Linking (Case 1) or Name Conflict (Case 2)
  if (isPrimary) {
    // Check if phone was previously entered as a recommendation (Case 1: Chain Linking)
    const prevRecommendation = await RecommendationRequest.findOne({
      'people': {
        $elemMatch: {
          phoneNormalized: normalized,
          role: 'recommendation'
        }
      }
    }).select('requestNumber people.$').lean();

    if (prevRecommendation) {
      return {
        isAvailable: true,
        isChainLink: true,
        parentRequestNumber: prevRecommendation.requestNumber,
        message: `موصى بك سابقاً في الطلب (${prevRecommendation.requestNumber}). سيتم ربط حسابك بشبكة الترشيح واعتماد قائمتك الجديدة دون تكرار.`,
        phone: phoneValidation.phone,
        normalized
      };
    }

    // Check if phone exists with a different name in RecommendationRequest or Candidate (Case 2: Conflict)
    const [existingReq, existingCand] = await Promise.all([
      RecommendationRequest.findOne({ 'people.phoneNormalized': normalized })
        .sort({ createdAt: -1 })
        .select('requestNumber people.fullName people.phoneNormalized')
        .lean(),
      Candidate.findOne({ phoneNormalized: normalized, isDeleted: false })
        .select('fullName phoneNormalized')
        .lean()
    ]);

    const existingName =
      existingReq?.people?.find((p) => p.phoneNormalized === normalized)?.fullName ||
      existingCand?.fullName;

    if (existingName && currentName && areNamesSubstantiallyDifferent(existingName, currentName)) {
      return {
        isAvailable: true,
        isConflict: true,
        existingName,
        message: `الرقم مسجل سابقاً باسم (${existingName}). نظراً لاختلاف الاسم، سيتم قبول الطلب وإحالته للمراجعة الإدارية للتحقق (متابعة بعد 24 ساعة).`,
        phone: phoneValidation.phone,
        normalized
      };
    }
  }

  // 1. Check Candidate collection
  const existingCandidate = await Candidate.findOne({
    phoneNormalized: normalized,
    isDeleted: false
  }).select('_id fullName').lean();

  if (existingCandidate) {
    return {
      isAvailable: false,
      existsIn: 'candidate',
      message: 'هذا الشخص مسجل بالفعل مسبقاً، يرجى إدخال شخص آخر',
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
      message: 'هذا الشخص مسجل بالفعل مسبقاً، يرجى إدخال شخص آخر',
      phone: phoneValidation.phone
    };
  }

  // 3. Check existing RecommendationRequests (pending or approved)
  const existingReq = await RecommendationRequest.findOne({
    status: { $in: ['pending', 'phone_duplicate_pending', 'approved'] },
    'people.phoneNormalized': normalized
  }).select('requestNumber status').lean();

  if (existingReq) {
    return {
      isAvailable: false,
      existsIn: 'recommendation',
      message: 'هذا الشخص مسجل بالفعل مسبقاً، يرجى إدخال شخص آخر',
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
  return `REC-${Date.now().toString().slice(-6)}`;
}

/**
 * Creates Candidate documents in the database from a RecommendationRequest
 * so that employers/companies can browse and search them.
 */
async function createCandidatesFromRecommendationRequest(request, { includeSubmitter = true } = {}) {
  const created = [];
  const primaryPerson = request.people?.[0] || {};

  for (let i = 0; i < request.people.length; i++) {
    const person = request.people[i];
    const isSubmitter = i === 0;

    if (isSubmitter && !includeSubmitter) {
      // Main submitter is rejected and strictly hidden from companies
      continue;
    }

    try {
      // Check if Candidate document already exists
      let candidate = await Candidate.findOne({
        phoneNormalized: person.phoneNormalized,
        isDeleted: false
      });

      const titles = person.titles && person.titles.length > 0
        ? person.titles
        : [{
            jobId: person.jobId,
            jobTitle: person.jobTitle || '',
            jobTitleAr: person.jobTitleAr || '',
            careerLevel: person.careerLevel,
            priority: 1
          }];

      const primaryTitle = titles[0];
      const secondTitle = titles[1] || null;
      const thirdTitle = titles[2] || null;

      if (candidate) {
        let changed = false;
        if (!candidate.recommendationRequestId) {
          candidate.recommendationRequestId = request._id;
          candidate.recommendationRequestNumber = request.requestNumber;
          changed = true;
        }
        if (!candidate.secondJobId && secondTitle) {
          candidate.secondJobId = secondTitle.jobId;
          candidate.secondCareerLevel = secondTitle.careerLevel || '';
          changed = true;
        }
        if (!candidate.thirdJobId && thirdTitle) {
          candidate.thirdJobId = thirdTitle.jobId;
          candidate.thirdCareerLevel = thirdTitle.careerLevel || '';
          changed = true;
        }
        if ((!candidate.desiredJobs || candidate.desiredJobs.length === 0) && titles.length > 0) {
          candidate.desiredJobs = titles.map((t, idx) => ({
            jobId: t.jobId,
            jobTitle: t.jobTitle || '',
            jobTitleAr: t.jobTitleAr || '',
            careerLevel: t.careerLevel || '',
            priority: idx + 1
          }));
          changed = true;
        }
        if (changed) await candidate.save();
        created.push(candidate);
        continue;
      }

      // Check or create corresponding User account
      let user = await User.findOne({ phoneNormalized: person.phoneNormalized });
      if (!user) {
        const randomPass = crypto.randomBytes(8).toString('hex') + '@2026';
        const passwordHash = await bcrypt.hash(randomPass, 10);
        user = await User.create({
          phone: person.phone,
          phoneNormalized: person.phoneNormalized,
          passwordHash,
          role: 'candidate',
          accountStatus: 'active'
        });
      }

      // Find job to link category
      const job = await Job.findById(primaryTitle.jobId).lean();

      // Calculate approximate experience years
      let expYears = 2;
      if (primaryTitle.careerLevel?.includes('7')) expYears = 8;
      else if (primaryTitle.careerLevel?.includes('5')) expYears = 6;
      else if (primaryTitle.careerLevel?.includes('3')) expYears = 4;

      const candidateSkills = titles
        .map((t) => t.jobTitleAr || t.jobTitle)
        .filter(Boolean);

      const candidateDoc = await Candidate.create({
        userId: user._id,
        fullName: person.fullName,
        phone: person.phone,
        phoneNormalized: person.phoneNormalized,
        desiredJobId: primaryTitle.jobId,
        careerLevel: primaryTitle.careerLevel || '',
        secondJobId: secondTitle ? secondTitle.jobId : null,
        secondCareerLevel: secondTitle ? secondTitle.careerLevel || '' : '',
        thirdJobId: thirdTitle ? thirdTitle.jobId : null,
        thirdCareerLevel: thirdTitle ? thirdTitle.careerLevel || '' : '',
        desiredJobs: titles.map((t, idx) => ({
          jobId: t.jobId,
          jobTitle: t.jobTitle || '',
          jobTitleAr: t.jobTitleAr || '',
          careerLevel: t.careerLevel || '',
          priority: idx + 1
        })),
        categoryId: job?.categoryId || null,
        governorate: 'Sharqia',
        area: '10th of Ramadan',
        yearsOfExperience: expYears,
        qualification: 'Technical Diploma',
        skills: candidateSkills.length > 0 ? candidateSkills : ['Industrial'],
        availabilityStatus: 'Available',
        accountStatus: 'active',
        consentGiven: true,
        consentDate: new Date(),
        isRecommendation: !isSubmitter,
        recommendationRequestId: request._id,
        recommendationRequestNumber: request.requestNumber,
        referredByName: !isSubmitter ? (request.rejectedSubmitterName || primaryPerson.fullName || '') : '',
        referredByPhone: !isSubmitter ? (request.rejectedSubmitterPhone || primaryPerson.phone || '') : '',
        adminNotes: !isSubmitter
          ? `مرشح موصى به عبر الطلب [${request.requestNumber}]${
              !includeSubmitter
                ? ` — مقدم الطلب الأساسي مستبعد (${primaryPerson.fullName} - ${primaryPerson.phone})`
                : ` — ترشيح بواسطة (${primaryPerson.fullName})`
            }`
          : `مقدم طلب الترشيح [${request.requestNumber}]`
      });

      created.push(candidateDoc);
    } catch (err) {
      console.warn(`[Recommendation Candidate Creation] Failed for ${person.fullName}:`, err.message);
    }
  }

  return created;
}

/**
 * Submits a new group recommendation request (submitter + at least 1 recommendation)
 * Handles Case 1 (Chain Linking) and Case 2 (Phone Conflict / Different Names).
 */
async function submitRecommendationRequest({ people, legalAccepted, ip = '', userAgent = '' }) {
  if (!legalAccepted) {
    throw {
      statusCode: 400,
      code: 'LEGAL_REQUIRED',
      message: 'يجب الموافقة والإقرار بالمسؤولية القانونية لتقديم الطلب.'
    };
  }

  if (!Array.isArray(people) || people.length < 2) {
    throw {
      statusCode: 400,
      code: 'INVALID_PEOPLE_COUNT',
      message: 'يجب إدخال بيانات شخصين على الأقل (مقدم الطلب + مرشح موصى به واحد على الأقل).'
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

    // 3. Validate Titles and Career Levels (up to 3 per person)
    const rawTitles = Array.isArray(person.titles) && person.titles.length > 0
      ? person.titles.slice(0, 3)
      : [{ jobId: person.jobId, careerLevel: person.careerLevel }];

    const validTitles = [];
    const seenJobIdsForPerson = new Set();
    const titleErrors = [];

    for (let tIdx = 0; tIdx < rawTitles.length; tIdx++) {
      const t = rawTitles[tIdx] || {};
      const tErr = {};

      if (!t.jobId || !mongoose.Types.ObjectId.isValid(t.jobId)) {
        tErr.jobId = 'يرجى اختيار مسمى وظيفي معتمد من القائمة';
      } else if (seenJobIdsForPerson.has(String(t.jobId))) {
        tErr.jobId = 'تم اختيار هذا المسمى الوظيفي مسبقاً لنفس الشخص';
      } else {
        seenJobIdsForPerson.add(String(t.jobId));
      }

      if (!t.careerLevel || !CAREER_LEVELS.includes(t.careerLevel)) {
        tErr.careerLevel = 'يرجى اختيار مستوى خبرة صحيح من القائمة المتاحة';
      }

      if (Object.keys(tErr).length > 0) {
        titleErrors[tIdx] = tErr;
      } else {
        validTitles.push({
          jobId: t.jobId,
          careerLevel: t.careerLevel,
          priority: tIdx + 1
        });
      }
    }

    if (titleErrors.length > 0 || validTitles.length === 0) {
      personErrors.titles = titleErrors;
      if (titleErrors[0]?.jobId) personErrors.jobId = titleErrors[0].jobId;
      if (titleErrors[0]?.careerLevel) personErrors.careerLevel = titleErrors[0].careerLevel;
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
        jobId: validTitles[0].jobId,
        careerLevel: validTitles[0].careerLevel,
        titles: validTitles
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

  // Verify all jobIds across all titles exist and pull their titles
  const allJobIds = [];
  for (const p of processedPeople) {
    for (const t of p.titles) {
      allJobIds.push(t.jobId);
    }
  }
  const foundJobs = await Job.find({ _id: { $in: allJobIds } }).lean();
  const jobMap = new Map();
  foundJobs.forEach((j) => jobMap.set(j._id.toString(), j));

  for (const p of processedPeople) {
    for (const t of p.titles) {
      const job = jobMap.get(t.jobId.toString());
      if (!job) {
        throw {
          statusCode: 400,
          code: 'JOB_NOT_FOUND',
          message: `الوظيفة المحددة للمرشح "${p.fullName}" غير موجودة في النظام.`
        };
      }
      t.jobTitle = job.name || '';
      t.jobTitleAr = job.nameAr || job.name || '';
    }
    // Mirror 1st title to root
    p.jobTitle = p.titles[0].jobTitle;
    p.jobTitleAr = p.titles[0].jobTitleAr;
    p.jobId = p.titles[0].jobId;
    p.careerLevel = p.titles[0].careerLevel;
  }

  const primarySubmitter = processedPeople[0];
  const recommendations = processedPeople.slice(1);

  // Generate unique request number
  const requestNumber = await generateRequestNumber();

  // =========================================================================
  // CASE 1: Chain Linking Check
  // Has this submitter previously appeared as a recommendation under another submitter?
  // =========================================================================
  const parentChainReq = await RecommendationRequest.findOne({
    'people': {
      $elemMatch: {
        phoneNormalized: primarySubmitter.phoneNormalized,
        role: 'recommendation'
      }
    }
  }).sort({ createdAt: -1 });

  let isChainLinked = false;
  let chainParentRequestNumber = null;
  let chainParentSubmitterName = null;
  let chainParentSubmitterPhone = null;

  if (parentChainReq) {
    isChainLinked = true;
    chainParentRequestNumber = parentChainReq.requestNumber;
    chainParentSubmitterName = parentChainReq.people[0]?.fullName || 'مقدم الطلب السابق';
    chainParentSubmitterPhone = parentChainReq.people[0]?.phone || '';

    // Register child request in parent request record
    if (!parentChainReq.chainChildrenRequestNumbers?.includes(requestNumber)) {
      parentChainReq.chainChildrenRequestNumbers = [
        ...(parentChainReq.chainChildrenRequestNumbers || []),
        requestNumber
      ];
      await parentChainReq.save().catch(() => {});
    }
  }

  // =========================================================================
  // CASE 2: Phone Conflict Check (2 different names with the same phone)
  // =========================================================================
  let hasPhoneConflict = false;
  let phoneConflictStatus = 'none';
  let phoneConflictDetails = {};

  const [existingSamePhoneReq, existingSamePhoneCand] = await Promise.all([
    RecommendationRequest.findOne({
      'people.phoneNormalized': primarySubmitter.phoneNormalized
    }).sort({ createdAt: -1 }),
    Candidate.findOne({
      phoneNormalized: primarySubmitter.phoneNormalized,
      isDeleted: false
    })
  ]);

  const priorName =
    existingSamePhoneReq?.people?.find((p) => p.phoneNormalized === primarySubmitter.phoneNormalized)?.fullName ||
    existingSamePhoneCand?.fullName;

  if (priorName && areNamesSubstantiallyDifferent(priorName, primarySubmitter.fullName)) {
    // Different names with the same phone number -> CASE 2!
    hasPhoneConflict = true;
    phoneConflictStatus = 'pending_investigation';
    phoneConflictDetails = {
      conflictingPhone: primarySubmitter.phone,
      firstRequestNumber: existingSamePhoneReq?.requestNumber || 'CANDIDATE_PROFILE',
      firstSubmitterName: priorName,
      secondRequestNumber: requestNumber,
      secondSubmitterName: primarySubmitter.fullName
    };
  }

  // Check recommendations (people 1..10) against existing DB
  const recPhonesList = recommendations.map((r) => r.phoneNormalized);
  const [existingRecCandidates, existingRecUsers, existingRecRequests] = await Promise.all([
    Candidate.find({ phoneNormalized: { $in: recPhonesList }, isDeleted: false }).select('phoneNormalized').lean(),
    User.find({ phoneNormalized: { $in: recPhonesList } }).select('phoneNormalized').lean(),
    RecommendationRequest.find({
      status: { $in: ['pending', 'phone_duplicate_pending', 'approved'] },
      'people.phoneNormalized': { $in: recPhonesList }
    }).select('requestNumber people.phoneNormalized').lean()
  ]);

  const existingRecPhonesSet = new Set();
  existingRecCandidates.forEach((c) => existingRecPhonesSet.add(c.phoneNormalized));
  existingRecUsers.forEach((u) => existingRecPhonesSet.add(u.phoneNormalized));
  existingRecRequests.forEach((r) => {
    r.people?.forEach((p) => {
      if (recPhonesList.includes(p.phoneNormalized)) {
        existingRecPhonesSet.add(p.phoneNormalized);
      }
    });
  });

  // If any recommended person (indices 1..10) has a phone already in DB, block and identify their indices
  const duplicateRecIndices = [];
  const duplicateRecPhones = [];
  processedPeople.forEach((p, idx) => {
    if (idx > 0 && existingRecPhonesSet.has(p.phoneNormalized)) {
      duplicateRecIndices.push(idx);
      duplicateRecPhones.push(p.phone);
    }
  });

  if (duplicateRecIndices.length > 0) {
    throw {
      statusCode: 409,
      code: 'DUPLICATE_PHONE',
      message: 'هذا الشخص مسجل بالفعل مسبقاً، يرجى إدخال شخص آخر',
      duplicateIndices: duplicateRecIndices,
      duplicatePhones: duplicateRecPhones
    };
  }

  // If submitter has identical name duplicate (not a conflict, not a chain link), block standard duplicate
  if (!isChainLinked && !hasPhoneConflict) {
    const isSubmitterDuplicate =
      (existingSamePhoneReq && !areNamesSubstantiallyDifferent(priorName, primarySubmitter.fullName)) ||
      (existingSamePhoneCand && !areNamesSubstantiallyDifferent(priorName, primarySubmitter.fullName));

    if (isSubmitterDuplicate) {
      throw {
        statusCode: 409,
        code: 'DUPLICATE_PHONE',
        message: 'هذا الشخص مسجل بالفعل مسبقاً، يرجى إدخال شخص آخر',
        duplicateIndices: [0],
        duplicatePhones: [primarySubmitter.phone]
      };
    }
  }

  // Determine initial status:
  // If phone conflict detected -> 'phone_duplicate_pending' (follow up after 24 hours)
  // Otherwise -> 'pending'
  const initialStatus = hasPhoneConflict ? 'phone_duplicate_pending' : 'pending';

  // Create request document
  const request = await RecommendationRequest.create({
    requestNumber,
    status: initialStatus,
    legalAccepted: true,
    submitterIp: ip,
    submitterUserAgent: userAgent,
    isChainLinked,
    chainParentRequestNumber,
    chainParentSubmitterName,
    chainParentSubmitterPhone,
    hasPhoneConflict,
    phoneConflictStatus,
    phoneConflictDetails,
    people: processedPeople.map(({ index, ...rest }) => rest)
  });

  // Dispatch Super Admin Notifications
  if (hasPhoneConflict) {
    // Notify admin about Case 2
    await AdminNotification.create({
      type: 'PHONE_CONFLICT_DIFFERENT_NAMES',
      priority: 'high',
      title: 'تضارب هاتف: تسجيل نفس الرقم باسمين مختلفين',
      message: `تم تسجيل رقم الهاتف (${primarySubmitter.phone}) باسم جديد "${primarySubmitter.fullName}" في الطلب [${requestNumber}]، بينما مسجل سابقاً باسم "${priorName}". الطلب قيد التدقيق الإداري (متابعة 24 ساعة).`,
      requestId: request._id,
      requestNumber,
      data: {
        conflictingPhone: primarySubmitter.phone,
        firstListing: {
          requestNumber: existingSamePhoneReq?.requestNumber || 'CANDIDATE_PROFILE',
          submitterName: priorName,
          submitterPhone: primarySubmitter.phone,
          status: existingSamePhoneReq?.status || 'Active'
        },
        secondListing: {
          requestNumber,
          submitterName: primarySubmitter.fullName,
          submitterPhone: primarySubmitter.phone,
          submittedAt: new Date(),
          recommendationsCount: recommendations.length,
          people: recommendations.map((r) => ({
            fullName: r.fullName,
            phone: r.phone,
            jobTitle: r.jobTitleAr || r.jobTitle,
            careerLevel: r.careerLevel
          }))
        }
      }
    }).catch((err) => console.error('[Notification Dispatch Error]', err.message));
  } else if (isChainLinked) {
    // Notify admin about Case 1
    await AdminNotification.create({
      type: 'CHAIN_LINKED_RECOMMENDATION',
      priority: 'medium',
      title: 'ارتباط شبكي: مرشح موصى به سابقاً سجل كمرشح رئيسي',
      message: `قام المرشح "${primarySubmitter.fullName}" الموصى به سابقاً في الطلب [${chainParentRequestNumber}] بواسطة "${chainParentSubmitterName}"، بالتسجيل كمرشح رئيسي برقم [${requestNumber}] وأضاف ${recommendations.length} ترشيحات جديدة تحت حسابه.`,
      requestId: request._id,
      requestNumber,
      data: {
        chain: {
          parentRequestNumber: chainParentRequestNumber,
          parentSubmitterName: chainParentSubmitterName,
          parentSubmitterPhone: chainParentSubmitterPhone,
          newRequestNumber: requestNumber,
          newSubmitterName: primarySubmitter.fullName,
          newSubmitterPhone: primarySubmitter.phone,
          recommendationsCount: recommendations.length
        }
      }
    }).catch((err) => console.error('[Notification Dispatch Error]', err.message));
  }

  return {
    success: true,
    requestNumber: request.requestNumber,
    status: request.status,
    isPendingConflict: hasPhoneConflict,
    isChainLinked,
    totalPeople: request.people.length,
    submitterName: primarySubmitter.fullName,
    createdAt: request.createdAt,
    message: hasPhoneConflict
      ? 'تم تسجيل طلبك برقم مرجعي. نظراً لتطابق رقم الهاتف مع طلب سابق باسم مختلف، الطلب قيد المراجعة الإدارية للتحقق. يُرجى المتابعة بعد 24 ساعة برقم الطلب.'
      : 'تم تقديم طلب الترشيحات بنجاح، وهو الآن قيد المراجعة والتدقيق الإداري.'
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
  const maskedPeople = request.people.map((p) => {
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
    isPendingConflict: request.status === 'phone_duplicate_pending',
    conflictFollowUpMessage:
      request.status === 'phone_duplicate_pending'
        ? 'الطلب قيد المراجعة والتدقيق الإداري للتحقق من تطابق رقم الهاتف. يرجى المتابعة بعد مرور 24 ساعة برقم الطلب.'
        : '',
    submitterName: submitter.fullName,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
    adminNotes: request.adminNotes || '',
    isChainLinked: request.isChainLinked || false,
    chainParentRequestNumber: request.chainParentRequestNumber || null,
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

  const statusCounts = {
    pending: 0,
    phone_duplicate_pending: 0,
    approved: 0,
    partially_approved: 0,
    rejected: 0,
    total: 0
  };

  counts.forEach((c) => {
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
 * Admin: Resolves a phone conflict through one of the 3 specified options:
 * 1. approve_both: Approve both listings with the same phone number.
 * 2. reject_main_keep_recommendations: Reject main number and add recommendations so companies can see them.
 * 3. reject_whole_listing: Reject the whole listing.
 */
async function resolvePhoneConflict(requestId, { action, notes = '' }, adminUserId) {
  const request = await RecommendationRequest.findById(requestId);
  if (!request) {
    throw { statusCode: 404, message: 'طلب الترشيح غير موجود', code: 'NOT_FOUND' };
  }

  const primaryPerson = request.people[0];

  if (action === 'approve_both') {
    request.status = 'approved';
    request.phoneConflictStatus = 'approved_both';
    request.phoneConflictDetails = {
      ...request.phoneConflictDetails,
      resolvedAt: new Date(),
      resolutionAction: 'approved_both',
      resolutionNotes: notes
    };
    request.adminNotes = notes || 'تم اعتماد وتأكيد الطلبين معاً برقم الهاتف المشترك.';
    request.reviewedBy = adminUserId;
    request.reviewedAt = new Date();
    await request.save();

    // Create Candidate documents for all 11 persons (submitter + recommendations)
    await createCandidatesFromRecommendationRequest(request, { includeSubmitter: true });

  } else if (action === 'reject_main_keep_recommendations') {
    request.status = 'partially_approved';
    request.phoneConflictStatus = 'rejected_main_kept_recommendations';
    request.recommendationsOnlyApproved = true;
    request.rejectedSubmitterName = primaryPerson.fullName;
    request.rejectedSubmitterPhone = primaryPerson.phone;
    request.phoneConflictDetails = {
      ...request.phoneConflictDetails,
      resolvedAt: new Date(),
      resolutionAction: 'rejected_main_kept_recommendations',
      resolutionNotes: notes
    };
    request.adminNotes =
      notes ||
      `تم استبعاد رقم الهاتف الأساسي (${primaryPerson.phone}) واعتماد الـ ${(request.people?.length || 1) - 1} ترشيحات المرفقة في قاعدة البيانات للشركات.`;
    request.reviewedBy = adminUserId;
    request.reviewedAt = new Date();
    await request.save();

    // Create Candidate documents for recommendations 1..10 only (submitter excluded)
    await createCandidatesFromRecommendationRequest(request, { includeSubmitter: false });

  } else if (action === 'reject_whole_listing') {
    request.status = 'rejected';
    request.phoneConflictStatus = 'rejected_whole';
    request.phoneConflictDetails = {
      ...request.phoneConflictDetails,
      resolvedAt: new Date(),
      resolutionAction: 'rejected_whole',
      resolutionNotes: notes
    };
    request.adminNotes = notes || 'تم رفض وإلغاء الطلب بالكامل نظراً لتضارب بيانات الهاتف.';
    request.reviewedBy = adminUserId;
    request.reviewedAt = new Date();
    await request.save();
  } else {
    throw { statusCode: 400, message: 'إجراء غير صالح', code: 'INVALID_ACTION' };
  }

  // Update corresponding AdminNotification if present
  await AdminNotification.updateMany(
    { requestId: request._id },
    {
      status: 'read',
      'data.resolution': {
        action,
        resolvedAt: new Date(),
        resolvedBy: adminUserId,
        notes
      }
    }
  );

  return {
    success: true,
    requestNumber: request.requestNumber,
    status: request.status,
    phoneConflictStatus: request.phoneConflictStatus,
    actionTaken: action
  };
}

/**
 * Admin: Update request status (approve or reject)
 */
async function adminUpdateRequestStatus(id, { status, adminNotes = '' }, adminUserId) {
  if (!['approved', 'rejected', 'pending', 'partially_approved'].includes(status)) {
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

  // If approved, create candidates so employers can discover them
  if (status === 'approved') {
    await createCandidatesFromRecommendationRequest(request, { includeSubmitter: true });
  }

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
  adminUpdateRequestStatus,
  resolvePhoneConflict,
  createCandidatesFromRecommendationRequest
};
