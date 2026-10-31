const mongoose = require('mongoose');
const User = require('../models/User');
const Candidate = require('../models/Candidate');
const Company = require('../models/Company');
const Job = require('../models/Job');
const JobCategory = require('../models/JobCategory');
const RecruitmentRequest = require('../models/RecruitmentRequest');
const CandidateReport = require('../models/CandidateReport');
const Subscription = require('../models/Subscription');
const SystemSetting = require('../models/SystemSetting');
const { getPagination, formatPagination } = require('../utils/pagination');
const { logActivity } = require('./activity.service');
const { escapeRegex } = require('../middleware/sanitize.middleware');

async function getDashboardMetrics() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    totalCandidates,
    availableCandidates,
    totalCompanies,
    pendingCompanies,
    approvedCompanies,
    activeSubscriptions,
    pendingReports,
    totalRequests,
    candidatesToday,
    companiesToday,
    candidatesByAvailability,
    topJobsAggregation
  ] = await Promise.all([
    Candidate.countDocuments({ isDeleted: false }),
    Candidate.countDocuments({ availabilityStatus: 'Available', isDeleted: false, accountStatus: 'active' }),
    Company.countDocuments({ isDeleted: false }),
    Company.countDocuments({ verificationStatus: 'Pending', isDeleted: false }),
    Company.countDocuments({ verificationStatus: 'Approved', isDeleted: false }),
    Company.countDocuments({ subscriptionStatus: 'active', isDeleted: false }),
    CandidateReport.countDocuments({ status: 'Open' }),
    RecruitmentRequest.countDocuments(),
    Candidate.countDocuments({ createdAt: { $gte: startOfToday }, isDeleted: false }),
    Company.countDocuments({ createdAt: { $gte: startOfToday }, isDeleted: false }),
    Candidate.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$availabilityStatus', count: { $sum: 1 } } }
    ]),
    Candidate.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$desiredJobId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
      {
        $lookup: {
          from: 'jobs',
          localField: '_id',
          foreignField: '_id',
          as: 'job'
        }
      },
      { $unwind: '$job' },
      {
        $project: {
          _id: 1,
          count: 1,
          name: '$job.name',
          nameAr: '$job.nameAr'
        }
      }
    ])
  ]);

  return {
    cartDiagnostic,
    totalCandidates,
    availableCandidates,
    totalCompanies,
    pendingCompanies,
    approvedCompanies,
    activeSubscriptions,
    pendingReports,
    totalRequests,
    candidatesToday,
    companiesToday,
    candidatesByAvailability: candidatesByAvailability.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {}),
    topJobs: topJobsAggregation
  };
}

async function listCandidatesForAdmin(queryParams) {
  const { page, limit, skip } = getPagination(queryParams, 20);
  const filter = { isDeleted: false };

  const {
    jobId,
    categoryId,
    governorate,
    area,
    availability,
    accountStatus,
    keyword
  } = queryParams;

  if (jobId && jobId !== 'ALL') {
    if (mongoose.Types.ObjectId.isValid(jobId)) {
      filter.desiredJobId = new mongoose.Types.ObjectId(jobId);
    } else {
      filter.desiredJobId = jobId;
    }
  }
  if (categoryId && categoryId !== 'ALL') {
    if (mongoose.Types.ObjectId.isValid(categoryId)) {
      filter.categoryId = new mongoose.Types.ObjectId(categoryId);
    } else {
      filter.categoryId = categoryId;
    }
  }
  if (availability && availability !== 'ALL') filter.availabilityStatus = availability;
  if (accountStatus && accountStatus !== 'ALL') filter.accountStatus = accountStatus;
  if (governorate && governorate !== 'ALL') filter.governorate = new RegExp(escapeRegex(governorate.trim()), 'i');
  if (area && area !== 'ALL') filter.area = new RegExp(escapeRegex(area.trim()), 'i');

  if (keyword && keyword.trim()) {
    const kw = keyword.trim();
    const regex = new RegExp(escapeRegex(kw), 'i');
    filter.$or = [
      { fullName: regex },
      { phone: regex },
      { phoneNormalized: regex },
      { email: regex },
      { area: regex }
    ];
  }

  const [items, total] = await Promise.all([
    Candidate.find(filter)
      .populate('desiredJobId', 'name nameAr')
      .populate('categoryId', 'name nameAr')
      .populate('userId', 'role accountStatus isBlocked email phone')
      .populate('invitedBy', 'fullName phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Candidate.countDocuments(filter)
  ]);

  return {
    items,
    pagination: formatPagination(total, page, limit)
  };
}

async function updateCandidateAdmin(candidateId, updateData, adminUser, req) {
  const candidate = await Candidate.findById(candidateId);
  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate not found.', code: 'CANDIDATE_NOT_FOUND' };
  }

  const allowedFields = [
    'fullName',
    'phone',
    'email',
    'governorate',
    'area',
    'yearsOfExperience',
    'qualification',
    'skills',
    'availabilityStatus',
    'accountStatus',
    'adminNotes'
  ];

  allowedFields.forEach((field) => {
    if (updateData[field] !== undefined) {
      candidate[field] = updateData[field];
    }
  });

  if (updateData.desiredJobId) {
    const job = await Job.findById(updateData.desiredJobId);
    if (job) {
      candidate.desiredJobId = job._id;
      candidate.categoryId = job.categoryId;
    }
  }

  await candidate.save();

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    action: 'CANDIDATE_UPDATED_BY_ADMIN',
    entityType: 'Candidate',
    entityId: candidate._id,
    metadata: { candidateName: candidate.fullName },
    req
  });

  return candidate;
}

async function updateCandidateStatus(candidateId, availabilityStatus, adminUser, req) {
  const candidate = await Candidate.findByIdAndUpdate(
    candidateId,
    { availabilityStatus },
    { new: true }
  );

  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate not found.', code: 'CANDIDATE_NOT_FOUND' };
  }

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    action: 'CANDIDATE_STATUS_CHANGED',
    entityType: 'Candidate',
    entityId: candidate._id,
    metadata: { newStatus: availabilityStatus },
    req
  });

  return candidate;
}

async function toggleBlockCandidate(candidateId, isBlocked, blockReason, adminUser, req) {
  const candidate = await Candidate.findById(candidateId);
  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate not found.', code: 'CANDIDATE_NOT_FOUND' };
  }

  candidate.accountStatus = isBlocked ? 'blocked' : 'active';
  await candidate.save();

  if (candidate.userId) {
    await User.findByIdAndUpdate(candidate.userId, {
      isBlocked,
      blockReason: blockReason || ''
    });
  }

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    action: isBlocked ? 'ACCOUNT_BLOCKED' : 'ACCOUNT_UNBLOCKED',
    entityType: 'Candidate',
    entityId: candidate._id,
    metadata: { isBlocked, blockReason },
    req
  });

  return candidate;
}

async function softDeleteCandidate(candidateId, adminUser, req) {
  const candidate = await Candidate.findByIdAndUpdate(
    candidateId,
    { isDeleted: true, deletedAt: new Date(), accountStatus: 'deactivated' },
    { new: true }
  );

  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate not found.', code: 'CANDIDATE_NOT_FOUND' };
  }

  if (candidate.userId) {
    await User.findByIdAndUpdate(candidate.userId, { accountStatus: 'deactivated' });
  }

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    action: 'CANDIDATE_DELETED',
    entityType: 'Candidate',
    entityId: candidate._id,
    metadata: { candidateName: candidate.fullName },
    req
  });

  return { success: true };
}

async function listCompaniesForAdmin(queryParams) {
  const { page, limit, skip } = getPagination(queryParams, 20);
  const filter = { isDeleted: false };

  const { verificationStatus, subscriptionStatus, keyword } = queryParams;

  if (verificationStatus && verificationStatus !== 'ALL') {
    filter.verificationStatus = verificationStatus;
  }

  if (subscriptionStatus && subscriptionStatus !== 'ALL') {
    filter.subscriptionStatus = subscriptionStatus;
  }

  if (keyword && keyword.trim()) {
    const regex = new RegExp(escapeRegex(keyword.trim()), 'i');
    filter.$or = [
      { companyName: regex },
      { email: regex },
      { phone: regex },
      { contactPerson: regex },
      { area: regex }
    ];
  }

  const [items, total] = await Promise.all([
    Company.find(filter)
      .populate('userId', 'isBlocked blockReason email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Company.countDocuments(filter)
  ]);

  return {
    items,
    pagination: formatPagination(total, page, limit)
  };
}

async function approveCompany(companyId, adminUser, req) {
  const company = await Company.findById(companyId);
  if (!company) {
    throw { statusCode: 404, message: 'Company not found.', code: 'COMPANY_NOT_FOUND' };
  }

  company.verificationStatus = 'Approved';
  company.rejectionReason = '';
  company.approvedAt = new Date();
  company.approvedBy = adminUser._id;
  await company.save();

  if (company.userId) {
    await User.findByIdAndUpdate(company.userId, { accountStatus: 'active' });
  }

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    action: 'COMPANY_APPROVED',
    entityType: 'Company',
    entityId: company._id,
    metadata: { companyName: company.companyName },
    req
  });

  return company;
}

async function rejectCompany(companyId, reason, adminUser, req) {
  const company = await Company.findById(companyId);
  if (!company) {
    throw { statusCode: 404, message: 'Company not found.', code: 'COMPANY_NOT_FOUND' };
  }

  company.verificationStatus = 'Rejected';
  company.rejectionReason = reason || 'Requirements not met.';
  await company.save();

  if (company.userId) {
    await User.findByIdAndUpdate(company.userId, { accountStatus: 'suspended' });
  }

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    action: 'COMPANY_REJECTED',
    entityType: 'Company',
    entityId: company._id,
    metadata: { companyName: company.companyName, reason },
    req
  });

  return company;
}

async function toggleBlockCompany(companyId, isBlocked, blockReason, adminUser, req) {
  const company = await Company.findById(companyId);
  if (!company) {
    throw { statusCode: 404, message: 'Company not found.', code: 'COMPANY_NOT_FOUND' };
  }

  company.isBlocked = isBlocked;
  company.blockReason = blockReason || '';
  if (isBlocked) {
    company.verificationStatus = 'Blocked';
  } else {
    company.verificationStatus = 'Approved';
  }
  await company.save();

  if (company.userId) {
    await User.findByIdAndUpdate(company.userId, {
      isBlocked,
      blockReason: blockReason || ''
    });
  }

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    action: isBlocked ? 'ACCOUNT_BLOCKED' : 'ACCOUNT_UNBLOCKED',
    entityType: 'Company',
    entityId: company._id,
    metadata: { companyName: company.companyName, isBlocked, blockReason },
    req
  });

  return company;
}

async function updateCompanySubscription(companyId, subData, adminUser, req) {
  const company = await Company.findById(companyId);
  if (!company) {
    throw { statusCode: 404, message: 'Company not found.', code: 'COMPANY_NOT_FOUND' };
  }

  const {
    subscriptionPlan,
    subscriptionStatus,
    durationDays,
    monthlyPriceEgp,
    searchLimit,
    exportLimit,
    viewLimit
  } = subData;

  if (subscriptionPlan) company.subscriptionPlan = subscriptionPlan;
  if (subscriptionStatus) company.subscriptionStatus = subscriptionStatus;
  if (monthlyPriceEgp !== undefined) company.monthlyPriceEgp = Number(monthlyPriceEgp);
  if (searchLimit !== undefined) company.searchLimit = Number(searchLimit);
  if (exportLimit !== undefined) company.exportLimit = Number(exportLimit);
  if (viewLimit !== undefined) company.viewLimit = Number(viewLimit);

  if (durationDays) {
    company.subscriptionStartDate = new Date();
    company.subscriptionEndDate = new Date(Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000);
  }

  await company.save();

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    action: 'SUBSCRIPTION_CHANGED',
    entityType: 'Company',
    entityId: company._id,
    metadata: { subscriptionPlan: company.subscriptionPlan, status: company.subscriptionStatus },
    req
  });

  return company;
}

// Job & Category catalogue memory cache for ultra-fast response times (<2ms)
let jobsCache = { active: null, all: null, expiresAt: 0 };
let categoriesCache = { active: null, all: null, expiresAt: 0 };
const CATALOG_CACHE_TTL_MS = 60000; // 60 seconds

function invalidateCatalogueCache() {
  jobsCache = { active: null, all: null, expiresAt: 0 };
  categoriesCache = { active: null, all: null, expiresAt: 0 };
}

// Job catalogue management
async function getAllJobs(includeInactive = false) {
  const now = Date.now();
  const cacheKey = includeInactive ? 'all' : 'active';
  if (jobsCache[cacheKey] && now < jobsCache.expiresAt) {
    return jobsCache[cacheKey];
  }

  const query = includeInactive ? {} : { isActive: true };
  const jobs = await Job.find(query)
    .populate('categoryId', 'name nameAr sortOrder isActive')
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  jobsCache[cacheKey] = jobs;
  jobsCache.expiresAt = now + CATALOG_CACHE_TTL_MS;
  return jobs;
}

async function createJob(data) {
  const { name, nameAr, categoryId, description, isActive, sortOrder } = data;
  if (!name || !nameAr || !categoryId) {
    throw { statusCode: 400, message: 'Job name (English & Arabic) and category are required.', code: 'FIELDS_REQUIRED' };
  }

  const trimmedName = name.trim();
  const trimmedNameAr = nameAr.trim();

  // SEC-46: Prevent duplicate titles across all categories
  const existingJob = await Job.findOne({
    $or: [
      { name: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') },
      { nameAr: trimmedNameAr }
    ]
  }).lean();

  if (existingJob) {
    throw {
      statusCode: 409,
      message: `مسمى وظيفي بهذا الاسم موجود بالفعل (${existingJob.nameAr || existingJob.name}). لا يمكن تكرار نفس المسمى عبر الأقسام.`,
      code: 'JOB_ALREADY_EXISTS'
    };
  }

  const job = await Job.create({
    name: trimmedName,
    nameAr: trimmedNameAr,
    categoryId,
    description: description || '',
    isActive: isActive !== undefined ? isActive : true,
    sortOrder: sortOrder || 0
  });
  invalidateCatalogueCache();
  return job;
}

async function updateJob(id, data) {
  if (data.name || data.nameAr) {
    const orConditions = [];
    if (data.name) orConditions.push({ name: new RegExp(`^${escapeRegex(data.name.trim())}$`, 'i') });
    if (data.nameAr) orConditions.push({ nameAr: data.nameAr.trim() });

    const duplicate = await Job.findOne({
      _id: { $ne: id },
      $or: orConditions
    }).lean();

    if (duplicate) {
      throw {
        statusCode: 409,
        message: `مسمى وظيفي بهذا الاسم موجود بالفعل (${duplicate.nameAr || duplicate.name}). لا يمكن تكرار نفس المسمى عبر الأقسام.`,
        code: 'JOB_ALREADY_EXISTS'
      };
    }
  }

  const job = await Job.findByIdAndUpdate(id, data, { new: true });
  if (!job) throw { statusCode: 404, message: 'Job not found.', code: 'JOB_NOT_FOUND' };
  invalidateCatalogueCache();
  return job;
}

async function deleteJob(id) {
  const job = await Job.findByIdAndDelete(id);
  if (!job) throw { statusCode: 404, message: 'Job not found.', code: 'JOB_NOT_FOUND' };
  invalidateCatalogueCache();
  return { success: true };
}

// Category catalogue management
async function getAllCategories(includeInactive = false) {
  const now = Date.now();
  const cacheKey = includeInactive ? 'all' : 'active';
  if (categoriesCache[cacheKey] && now < categoriesCache.expiresAt) {
    return categoriesCache[cacheKey];
  }

  const query = includeInactive
    ? { name: { $ne: 'Uncategorized' }, nameAr: { $ne: 'غير مصنف' } }
    : { isActive: true, name: { $ne: 'Uncategorized' }, nameAr: { $ne: 'غير مصنف' } };
  const categories = await JobCategory.find(query).sort({ sortOrder: 1, name: 1 }).lean();

  categoriesCache[cacheKey] = categories;
  categoriesCache.expiresAt = now + CATALOG_CACHE_TTL_MS;
  return categories;
}

async function createCategory(data) {
  const { name, nameAr, description, isActive, sortOrder } = data;
  if (!name || !nameAr) {
    throw { statusCode: 400, message: 'Category name (English & Arabic) is required.', code: 'FIELDS_REQUIRED' };
  }
  const category = await JobCategory.create({
    name: name.trim(),
    nameAr: nameAr.trim(),
    description: description || '',
    isActive: isActive !== undefined ? isActive : true,
    sortOrder: sortOrder || 0
  });
  invalidateCatalogueCache();
  return category;
}

async function updateCategory(id, data) {
  // Always mark as manually edited when admin touches it —
  // this prevents the auto-seed from ever overriding these fields again.
  const updatePayload = { ...data, manuallyEdited: true };
  const cat = await JobCategory.findByIdAndUpdate(id, updatePayload, { new: true });
  if (!cat) throw { statusCode: 404, message: 'Category not found.', code: 'CATEGORY_NOT_FOUND' };
  invalidateCatalogueCache();
  return cat;
}

async function deleteCategory(id) {
  const cat = await JobCategory.findByIdAndDelete(id);
  if (!cat) throw { statusCode: 404, message: 'Category not found.', code: 'CATEGORY_NOT_FOUND' };
  invalidateCatalogueCache();
  return { success: true };
}

// System settings
async function getSettings() {
  const settings = await SystemSetting.find().lean();
  return settings;
}

async function updateSetting(key, value, description = '') {
  const setting = await SystemSetting.findOneAndUpdate(
    { key },
    { value, description },
    { new: true, upsert: true }
  );
  return setting;
}

async function getCandidateByIdAdmin(candidateId) {
  const candidate = await Candidate.findById(candidateId)
    .populate('desiredJobId', 'name nameAr')
    .populate('categoryId', 'name nameAr')
    .populate('userId', 'role accountStatus isBlocked email phone')
    .populate('invitedBy', 'fullName phone')
    .lean();
  if (!candidate) throw { statusCode: 404, message: 'Candidate not found.', code: 'CANDIDATE_NOT_FOUND' };
  return candidate;
}

async function getCompanyByIdAdmin(companyId) {
  const company = await Company.findById(companyId)
    .populate('userId', 'role accountStatus isBlocked email phone')
    .lean();
  if (!company) throw { statusCode: 404, message: 'Company not found.', code: 'COMPANY_NOT_FOUND' };
  return company;
}

async function listRecruitmentRequestsAdmin(queryParams) {
  const { page, limit, skip } = getPagination(queryParams, 20);
  const filter = {};
  if (queryParams.status && queryParams.status !== 'ALL') {
    filter.status = queryParams.status;
  }
  const [items, total] = await Promise.all([
    RecruitmentRequest.find(filter)
      .populate('jobId', 'name nameAr')
      .populate('categoryId', 'name nameAr')
      .populate('companyId', 'companyName phone email area')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RecruitmentRequest.countDocuments(filter)
  ]);
  return {
    items,
    pagination: formatPagination(total, page, limit)
  };
}

async function updateRequestStatusAdmin(requestId, status, notes = '') {
  const reqDoc = await RecruitmentRequest.findByIdAndUpdate(
    requestId,
    { status, ...(notes ? { adminNotes: notes } : {}) },
    { new: true }
  );
  if (!reqDoc) throw { statusCode: 404, message: 'Request not found.', code: 'REQUEST_NOT_FOUND' };
  return reqDoc;
}

module.exports = {
  getDashboardMetrics,
  listCandidatesForAdmin,
  getCandidateByIdAdmin,
  updateCandidateAdmin,
  updateCandidateStatus,
  toggleBlockCandidate,
  softDeleteCandidate,
  listCompaniesForAdmin,
  getCompanyByIdAdmin,
  approveCompany,
  rejectCompany,
  toggleBlockCompany,
  updateCompanySubscription,
  listRecruitmentRequestsAdmin,
  updateRequestStatusAdmin,
  getAllJobs,
  createJob,
  updateJob,
  deleteJob,
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getSettings,
  updateSetting,
  invalidateCatalogueCache,
  getCandidatesWithoutJobTitle,
  restoreAndMergeTitles
};

function normalizeTitle(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/\s+/g, ' ');
}

// ── Restore candidate titles from when first added & merge duplicate titles ──
async function restoreAndMergeTitles({ dryRun = true } = {}) {
  // 1. Fetch all jobs
  const allJobs = await Job.find({}).lean();
  
  // 2. Find or create fallback category for any restored jobs that don't exist
  let fallbackCategory = await JobCategory.findOne({
    $or: [{ systemGenerated: true }, { name: 'General' }, { nameAr: 'عام' }, { nameAr: 'أخرى' }]
  });
  if (!fallbackCategory) {
    fallbackCategory = await JobCategory.findOne({ isActive: true });
  }

  // 3. Detect duplicate jobs by normalized nameAr / name
  const jobByNormTitle = new Map(); // normTitle -> canonicalJob
  const duplicateJobMap = new Map(); // duplicateJobIdString -> canonicalJobIdString
  const duplicateGroups = [];

  const groupedByNorm = new Map();
  for (const job of allJobs) {
    const norm = normalizeTitle(job.nameAr) || normalizeTitle(job.name);
    if (!groupedByNorm.has(norm)) {
      groupedByNorm.set(norm, []);
    }
    groupedByNorm.get(norm).push(job);
  }

  for (const [norm, list] of groupedByNorm.entries()) {
    if (list.length > 1) {
      // Pick canonical: prefer active, then oldest / lowest sortOrder
      list.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        if ((a.sortOrder || 0) !== (b.sortOrder || 0)) return (a.sortOrder || 0) - (b.sortOrder || 0);
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
      const canonical = list[0];
      const dupes = list.slice(1);
      duplicateGroups.push({
        normalized: norm,
        canonical: { _id: canonical._id.toString(), name: canonical.name, nameAr: canonical.nameAr },
        duplicates: dupes.map(d => ({ _id: d._id.toString(), name: d.name, nameAr: d.nameAr }))
      });
      for (const d of dupes) {
        duplicateJobMap.set(d._id.toString(), canonical._id.toString());
      }
      jobByNormTitle.set(norm, canonical);
    } else {
      jobByNormTitle.set(norm, list[0]);
    }
  }

  // Also map existing exact job IDs
  const existingJobIdSet = new Set(allJobs.map(j => j._id.toString()));

  // 4. Scan all candidates
  const allCandidates = await Candidate.find({ isDeleted: false }).lean();

  const candidateUpdates = [];
  const missingJobsToCreate = new Map(); // normTitle -> { name, nameAr }
  let alreadyValidCount = 0;

  for (const c of allCandidates) {
    let desiredJobIdStr = c.desiredJobId ? c.desiredJobId.toString() : null;
    let needsUpdate = false;
    let targetJob = null;

    // Check if candidate has primary title text in desiredJobs
    const primaryDesired = (c.desiredJobs && c.desiredJobs.length > 0) ? c.desiredJobs[0] : null;
    const titleText = (primaryDesired?.jobTitleAr || primaryDesired?.jobTitle || '').trim();
    const normTitleText = normalizeTitle(titleText);

    // Case A: desiredJobId points to a duplicate job -> remap to canonical
    if (desiredJobIdStr && duplicateJobMap.has(desiredJobIdStr)) {
      const canonicalIdStr = duplicateJobMap.get(desiredJobIdStr);
      targetJob = allJobs.find(j => j._id.toString() === canonicalIdStr);
      needsUpdate = true;
    }
    // Case B: desiredJobId points to a deleted job (not in existingJobIdSet) or is null
    else if (!desiredJobIdStr || !existingJobIdSet.has(desiredJobIdStr)) {
      if (normTitleText && jobByNormTitle.has(normTitleText)) {
        targetJob = jobByNormTitle.get(normTitleText);
        needsUpdate = true;
      } else if (normTitleText) {
        // Needs creation
        if (!missingJobsToCreate.has(normTitleText)) {
          missingJobsToCreate.set(normTitleText, {
            name: primaryDesired.jobTitle || primaryDesired.jobTitleAr,
            nameAr: primaryDesired.jobTitleAr || primaryDesired.jobTitle
          });
        }
        needsUpdate = true;
      }
    } else {
      // Already points to existing job, check if title text matches or if already valid
      alreadyValidCount++;
    }

    if (needsUpdate) {
      candidateUpdates.push({
        candidateId: c._id.toString(),
        fullName: c.fullName,
        phone: c.phone,
        currentJobId: desiredJobIdStr,
        originalTitle: titleText,
        normTitle: normTitleText,
        matchedJob: targetJob ? { _id: targetJob._id.toString(), nameAr: targetJob.nameAr } : null,
        status: targetJob ? 'ready_to_remap' : 'needs_job_creation'
      });
    }
  }

  // 5. If NOT dryRun (real execution):
  const executionResults = {
    jobsCreatedCount: 0,
    duplicateJobsRemovedCount: 0,
    candidatesUpdatedCount: 0
  };

  if (!dryRun) {
    // A. Create or find missing jobs safely
    for (const [norm, jobData] of missingJobsToCreate.entries()) {
      const cleanName = (jobData.name || jobData.nameAr || '').trim();
      const cleanNameAr = (jobData.nameAr || jobData.name || '').trim();
      if (!cleanName && !cleanNameAr) continue;

      let existing = await Job.findOne({
        $or: [
          { name: cleanName },
          { nameAr: cleanNameAr }
        ]
      });

      if (!existing) {
        try {
          existing = await Job.create({
            name: cleanName,
            nameAr: cleanNameAr,
            categoryId: fallbackCategory ? fallbackCategory._id : null,
            isActive: true,
            sortOrder: 0
          });
          executionResults.jobsCreatedCount++;
        } catch (err) {
          existing = await Job.findOne({
            $or: [{ name: cleanName }, { nameAr: cleanNameAr }]
          });
        }
      }

      if (existing) {
        jobByNormTitle.set(norm, existing);
        existingJobIdSet.add(existing._id.toString());
      }
    }

    // B. Bulk update candidates using bulkWrite for maximum speed and safety
    const candidateBulkOps = [];
    for (const item of candidateUpdates) {
      let finalJob = item.matchedJob;
      if (!finalJob && item.normTitle && jobByNormTitle.has(item.normTitle)) {
        const j = jobByNormTitle.get(item.normTitle);
        finalJob = { _id: j._id.toString(), nameAr: j.nameAr };
      }

      if (finalJob) {
        candidateBulkOps.push({
          updateOne: {
            filter: { _id: new mongoose.Types.ObjectId(item.candidateId) },
            update: {
              $set: {
                desiredJobId: new mongoose.Types.ObjectId(finalJob._id),
                'desiredJobs.0.jobId': new mongoose.Types.ObjectId(finalJob._id)
              }
            }
          }
        });
      }
    }

    if (candidateBulkOps.length > 0) {
      const bulkRes = await Candidate.bulkWrite(candidateBulkOps, { ordered: false });
      executionResults.candidatesUpdatedCount = (bulkRes.modifiedCount || 0) + (bulkRes.upsertedCount || 0);
    }

    // C. Remap secondJobId and thirdJobId if pointing to duplicates
    if (duplicateJobMap.size > 0) {
      for (const [dupId, canonId] of duplicateJobMap.entries()) {
        await Promise.all([
          Candidate.updateMany(
            { secondJobId: new mongoose.Types.ObjectId(dupId) },
            { $set: { secondJobId: new mongoose.Types.ObjectId(canonId) } }
          ),
          Candidate.updateMany(
            { thirdJobId: new mongoose.Types.ObjectId(dupId) },
            { $set: { thirdJobId: new mongoose.Types.ObjectId(canonId) } }
          )
        ]);
      }

      // Remove duplicate jobs
      const dupIds = Array.from(duplicateJobMap.keys()).map(id => new mongoose.Types.ObjectId(id));
      const delResult = await Job.deleteMany({ _id: { $in: dupIds } });
      executionResults.duplicateJobsRemovedCount = delResult.deletedCount;
    }

    // Clear catalogue cache
    invalidateCatalogueCache();
  }

  return {
    dryRun,
    totalCandidates: allCandidates.length,
    alreadyValidCandidates: alreadyValidCount,
    candidatesNeedingUpdate: candidateUpdates.length,
    duplicateGroupsCount: duplicateGroups.length,
    duplicateJobsCount: duplicateJobMap.size,
    duplicateGroupsSample: duplicateGroups.slice(0, 10),
    missingJobsToCreateCount: missingJobsToCreate.size,
    missingJobsSample: Array.from(missingJobsToCreate.values()).slice(0, 10),
    candidateUpdatesSample: candidateUpdates.slice(0, 10),
    executionResults: dryRun ? null : executionResults
  };
}

// ── Diagnostic: candidates that have no valid active job title ──────────────
async function getCandidatesWithoutJobTitle() {
  const totalCandidates = await Candidate.countDocuments({ isDeleted: false });
  const totalJobs = await Job.countDocuments({});
  const activeJobs = await Job.countDocuments({ isActive: true });

  // Test getCart for all companies to diagnose any 500 errors
  let cartDiagnostic = [];
  try {
    const cartService = require('./cart.service');
    const companies = await Company.find({ isDeleted: false }).limit(10).lean();
    for (const c of companies) {
      try {
        const cart = await cartService.getCart(c._id);
        cartDiagnostic.push({ companyId: c._id, companyName: c.companyName, status: 'ok', itemsCount: cart.items?.length || 0 });
      } catch (cErr) {
        cartDiagnostic.push({ companyId: c._id, companyName: c.companyName, status: 'error', error: cErr.message, stack: cErr.stack });
      }
    }
  } catch (err) {
    cartDiagnostic.push({ status: 'outer_error', error: err.message, stack: err.stack });
  }

  // 1. Candidates where desiredJobId is null / missing
  const nullJobId = await Candidate.find({
    isDeleted: false,
    $or: [{ desiredJobId: null }, { desiredJobId: { $exists: false } }]
  })
    .select('fullName phone accountStatus availabilityStatus createdAt desiredJobId desiredJobs')
    .limit(100)
    .lean();

  // 2. Candidates whose desiredJobId points to a non-existent or inactive Job
  const badRef = await Candidate.aggregate([
    { $match: { isDeleted: false, desiredJobId: { $ne: null, $exists: true } } },
    {
      $lookup: {
        from: 'jobs',
        localField: 'desiredJobId',
        foreignField: '_id',
        as: 'job'
      }
    },
    {
      $match: {
        $or: [
          { job: { $size: 0 } },          // job deleted from DB
          { 'job.0.isActive': false }       // job exists but inactive
        ]
      }
    },
    {
      $project: {
        fullName: 1,
        phone: 1,
        accountStatus: 1,
        availabilityStatus: 1,
        createdAt: 1,
        desiredJobId: 1,
        desiredJobs: 1,
        jobExists: { $gt: [{ $size: '$job' }, 0] },
        jobName: { $arrayElemAt: ['$job.name', 0] },
        jobNameAr: { $arrayElemAt: ['$job.nameAr', 0] },
        jobIsActive: { $arrayElemAt: ['$job.isActive', 0] }
      }
    }
  ]);

  const candidatesWithValidActiveJob = totalCandidates - (nullJobId.length + badRef.length);

  // Group badRef by issue
  const jobDeletedCount = badRef.filter(b => !b.jobExists).length;
  const jobInactiveCount = badRef.filter(b => b.jobExists && !b.jobIsActive).length;

  // Sample a few bad candidates with full desiredJobs to see if titles are preserved
  const sampleBadCandidates = badRef.slice(0, 5).map(c => ({
    _id: c._id,
    fullName: c.fullName,
    phone: c.phone,
    desiredJobId: c.desiredJobId,
    desiredJobs: c.desiredJobs,
    issue: c.jobExists ? 'job_inactive' : 'job_deleted'
  }));

  return {
    cartDiagnostic,
    totalCandidates,
    totalJobs,
    activeJobs,
    candidatesWithValidActiveJob,
    totalIssues: nullJobId.length + badRef.length,
    nullJobIdCount: nullJobId.length,
    badRefCount: badRef.length,
    jobDeletedCount,
    jobInactiveCount,
    sampleBadCandidates
  };
}


