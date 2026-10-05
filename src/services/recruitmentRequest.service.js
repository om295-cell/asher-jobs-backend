const RecruitmentRequest = require('../models/RecruitmentRequest');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const CandidateInteraction = require('../models/CandidateInteraction');
const { getPagination, formatPagination } = require('../utils/pagination');
const { logActivity } = require('./activity.service');

function generateRequestNumber() {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `REQ-${timestamp}-${random}`;
}

async function createRecruitmentRequest(company, requestData, req) {
  const {
    jobId,
    quantityRequested,
    governorate,
    area,
    minExperience,
    maxExperience,
    qualification,
    notes
  } = requestData;

  if (!jobId) {
    throw { statusCode: 400, message: 'Please specify the required job position.', code: 'JOB_REQUIRED' };
  }

  const quantity = parseInt(quantityRequested, 10);
  if (isNaN(quantity) || quantity < 1) {
    throw { statusCode: 400, message: 'Quantity requested must be at least 1 candidate.', code: 'INVALID_QUANTITY' };
  }

  const job = await Job.findById(jobId);
  if (!job || !job.isActive) {
    throw { statusCode: 400, message: 'Selected job is invalid or inactive.', code: 'INVALID_JOB' };
  }

  // Build matching candidate query
  const query = {
    desiredJobId: job._id,
    availabilityStatus: 'Available',
    accountStatus: 'active',
    isDeleted: false
  };

  if (governorate && governorate !== 'ALL') {
    query.governorate = new RegExp(governorate.trim(), 'i');
  }

  if (area && area !== 'ALL') {
    query.area = new RegExp(area.trim(), 'i');
  }

  if (qualification && qualification !== 'ALL') {
    query.qualification = new RegExp(qualification.trim(), 'i');
  }

  if (minExperience !== undefined && minExperience !== '' || maxExperience !== undefined && maxExperience !== '') {
    query.yearsOfExperience = {};
    if (minExperience !== undefined && minExperience !== '') {
      query.yearsOfExperience.$gte = Number(minExperience);
    }
    if (maxExperience !== undefined && maxExperience !== '') {
      query.yearsOfExperience.$lte = Number(maxExperience);
    }
  }

  // Find matching candidates up to the requested quantity
  const matchedCandidates = await Candidate.find(query)
    .sort({ yearsOfExperience: -1, createdAt: -1 })
    .limit(quantity)
    .populate('desiredJobId', 'name nameAr')
    .populate('categoryId', 'name nameAr');

  const candidateIds = matchedCandidates.map((c) => c._id);

  const recruitmentRequest = await RecruitmentRequest.create({
    requestNumber: generateRequestNumber(),
    companyId: company._id,
    jobId: job._id,
    categoryId: job.categoryId,
    quantityRequested: quantity,
    filters: {
      governorate: governorate || '',
      area: area || '',
      minExperience: minExperience || 0,
      maxExperience: maxExperience || '',
      qualification: qualification || '',
      availabilityStatus: 'Available'
    },
    notes: notes || '',
    status: 'Completed',
    candidatesReturned: candidateIds,
    candidatesSelected: candidateIds
  });

  await logActivity({
    actorId: company.userId,
    actorRole: 'company',
    action: 'RECRUITMENT_REQUEST_CREATED',
    entityType: 'RecruitmentRequest',
    entityId: recruitmentRequest._id,
    metadata: {
      job: job.name,
      quantityRequested: quantity,
      returnedCount: matchedCandidates.length
    },
    req
  });

  return {
    recruitmentRequest,
    totalMatched: matchedCandidates.length,
    candidates: matchedCandidates.map((c) => ({
      id: c._id,
      fullName: c.fullName,
      phone: c.phone,
      email: c.email,
      desiredJob: c.desiredJobId,
      category: c.categoryId,
      governorate: c.governorate,
      area: c.area,
      yearsOfExperience: c.yearsOfExperience,
      qualification: c.qualification,
      skills: c.skills,
      availabilityStatus: c.availabilityStatus,
      hasCv: !!c.cvUrl
    }))
  };
}

async function getCompanyRecruitmentRequests(companyId, queryParams) {
  const { page, limit, skip } = getPagination(queryParams, 20);

  const [items, total] = await Promise.all([
    RecruitmentRequest.find({ companyId })
      .populate('jobId', 'name nameAr')
      .populate('categoryId', 'name nameAr')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RecruitmentRequest.countDocuments({ companyId })
  ]);

  return {
    items,
    pagination: formatPagination(total, page, limit)
  };
}

async function getRecruitmentRequestById(requestId, companyId, isAdmin = false) {
  const query = { _id: requestId };
  if (!isAdmin && companyId) {
    query.companyId = companyId;
  }

  const reqDoc = await RecruitmentRequest.findOne(query)
    .populate('jobId', 'name nameAr')
    .populate('categoryId', 'name nameAr')
    .populate('companyId', 'companyName email phone governorate area')
    .populate({
      path: 'candidatesReturned',
      select: 'fullName phone email desiredJobId categoryId governorate area yearsOfExperience qualification skills availabilityStatus cvUrl',
      populate: [
        { path: 'desiredJobId', select: 'name nameAr' },
        { path: 'categoryId', select: 'name nameAr' }
      ]
    });

  if (!reqDoc) {
    throw { statusCode: 404, message: 'Recruitment request not found.', code: 'REQUEST_NOT_FOUND' };
  }

  return reqDoc;
}

async function logCandidateInteraction(companyId, candidateId, action, notes = '', requestId = null) {
  const validActions = [
    'CALL_CLICKED',
    'WHATSAPP_CLICKED',
    'CV_REQUESTED',
    'PROFILE_VIEWED',
    'CONTACTED',
    'INTERVIEW_SCHEDULED',
    'HIRED',
    'REJECTED'
  ];

  if (!validActions.includes(action)) {
    throw { statusCode: 400, message: 'Invalid interaction action.', code: 'INVALID_ACTION' };
  }

  const interaction = await CandidateInteraction.create({
    companyId,
    candidateId,
    recruitmentRequestId: requestId || null,
    action,
    notes: notes || ''
  });

  return interaction;
}

module.exports = {
  createRecruitmentRequest,
  getCompanyRecruitmentRequests,
  getRecruitmentRequestById,
  logCandidateInteraction
};
