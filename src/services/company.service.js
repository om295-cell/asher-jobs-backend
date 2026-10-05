const Company = require('../models/Company');
const JobSuggestion = require('../models/JobSuggestion');
const RecruitmentRequest = require('../models/RecruitmentRequest');
const Candidate = require('../models/Candidate');
const { logActivity } = require('./activity.service');

async function getMyCompanyProfile(userId) {
  const company = await Company.findOne({ userId, isDeleted: false });
  if (!company) {
    throw { statusCode: 404, message: 'Company profile not found.', code: 'COMPANY_NOT_FOUND' };
  }
  return company;
}

async function updateMyCompanyProfile(userId, updateData) {
  const company = await Company.findOne({ userId, isDeleted: false });
  if (!company) {
    throw { statusCode: 404, message: 'Company profile not found.', code: 'COMPANY_NOT_FOUND' };
  }

  const allowedFields = [
    'companyName',
    'phone',
    'address',
    'governorate',
    'area',
    'industry',
    'website',
    'contactPerson',
    'contactPersonPhone'
  ];

  allowedFields.forEach((field) => {
    if (updateData[field] !== undefined) {
      company[field] = updateData[field];
    }
  });

  await company.save();
  return company;
}

async function getCompanyDashboardStats(companyId) {
  const [totalAvailableCandidates, requestsCount, company] = await Promise.all([
    Candidate.countDocuments({ availabilityStatus: 'Available', accountStatus: 'active', isDeleted: false }),
    RecruitmentRequest.countDocuments({ companyId }),
    Company.findById(companyId)
  ]);

  return {
    totalAvailableCandidates,
    myRequestsCount: requestsCount,
    searchesUsed: company.searchesUsed || 0,
    searchLimit: company.searchLimit || 100,
    exportsUsed: company.exportsUsed || 0,
    exportLimit: company.exportLimit || 20,
    viewsUsed: company.viewsUsed || 0,
    viewLimit: company.viewLimit || 200,
    verificationStatus: company.verificationStatus,
    subscriptionStatus: company.subscriptionStatus,
    subscriptionPlan: company.subscriptionPlan,
    subscriptionEndDate: company.subscriptionEndDate
  };
}

async function suggestJobTitle(companyId, { proposedTitle, category, notes }, req) {
  if (!proposedTitle || !proposedTitle.trim()) {
    throw { statusCode: 400, message: 'Proposed job title is required.', code: 'TITLE_REQUIRED' };
  }

  const suggestion = await JobSuggestion.create({
    companyId,
    proposedTitle: proposedTitle.trim(),
    category: category || '',
    notes: notes || '',
    status: 'Pending'
  });

  await logActivity({
    actorId: req.user._id,
    actorRole: 'company',
    action: 'JOB_SUGGESTION_SUBMITTED',
    entityType: 'Job',
    metadata: { proposedTitle },
    req
  });

  return suggestion;
}

module.exports = {
  getMyCompanyProfile,
  updateMyCompanyProfile,
  getCompanyDashboardStats,
  suggestJobTitle
};
