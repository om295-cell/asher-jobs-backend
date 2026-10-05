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

  if (jobId && jobId !== 'ALL') filter.desiredJobId = jobId;
  if (categoryId && categoryId !== 'ALL') filter.categoryId = categoryId;
  if (availability && availability !== 'ALL') filter.availabilityStatus = availability;
  if (accountStatus && accountStatus !== 'ALL') filter.accountStatus = accountStatus;
  if (governorate && governorate !== 'ALL') filter.governorate = new RegExp(governorate.trim(), 'i');
  if (area && area !== 'ALL') filter.area = new RegExp(area.trim(), 'i');

  if (keyword && keyword.trim()) {
    const kw = keyword.trim();
    const regex = new RegExp(kw, 'i');
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
    const regex = new RegExp(keyword.trim(), 'i');
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

// Job catalogue management
async function getAllJobs(includeInactive = false) {
  const query = includeInactive ? {} : { isActive: true };
  return Job.find(query)
    .populate('categoryId', 'name nameAr sortOrder isActive')
    .sort({ sortOrder: 1, name: 1 })
    .lean();
}

async function createJob(data) {
  const { name, nameAr, categoryId, description, isActive, sortOrder } = data;
  if (!name || !nameAr || !categoryId) {
    throw { statusCode: 400, message: 'Job name (English & Arabic) and category are required.', code: 'FIELDS_REQUIRED' };
  }
  return Job.create({
    name: name.trim(),
    nameAr: nameAr.trim(),
    categoryId,
    description: description || '',
    isActive: isActive !== undefined ? isActive : true,
    sortOrder: sortOrder || 0
  });
}

async function updateJob(id, data) {
  const job = await Job.findByIdAndUpdate(id, data, { new: true });
  if (!job) throw { statusCode: 404, message: 'Job not found.', code: 'JOB_NOT_FOUND' };
  return job;
}

async function deleteJob(id) {
  const job = await Job.findByIdAndDelete(id);
  if (!job) throw { statusCode: 404, message: 'Job not found.', code: 'JOB_NOT_FOUND' };
  return { success: true };
}

// Category catalogue management
async function getAllCategories(includeInactive = false) {
  const query = includeInactive ? {} : { isActive: true };
  return JobCategory.find(query).sort({ sortOrder: 1, name: 1 }).lean();
}

async function createCategory(data) {
  const { name, nameAr, description, isActive, sortOrder } = data;
  if (!name || !nameAr) {
    throw { statusCode: 400, message: 'Category name (English & Arabic) is required.', code: 'FIELDS_REQUIRED' };
  }
  return JobCategory.create({
    name: name.trim(),
    nameAr: nameAr.trim(),
    description: description || '',
    isActive: isActive !== undefined ? isActive : true,
    sortOrder: sortOrder || 0
  });
}

async function updateCategory(id, data) {
  const cat = await JobCategory.findByIdAndUpdate(id, data, { new: true });
  if (!cat) throw { statusCode: 404, message: 'Category not found.', code: 'CATEGORY_NOT_FOUND' };
  return cat;
}

async function deleteCategory(id) {
  const cat = await JobCategory.findByIdAndDelete(id);
  if (!cat) throw { statusCode: 404, message: 'Category not found.', code: 'CATEGORY_NOT_FOUND' };
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
  updateSetting
};

