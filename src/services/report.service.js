const CandidateReport = require('../models/CandidateReport');
const Candidate = require('../models/Candidate');
const { getPagination, formatPagination } = require('../utils/pagination');
const { logActivity } = require('./activity.service');

async function createReport(company, { candidateId, type, description }, req) {
  if (!candidateId) {
    throw { statusCode: 400, message: 'Candidate ID is required.', code: 'CANDIDATE_REQUIRED' };
  }

  if (!description || !description.trim()) {
    throw { statusCode: 400, message: 'Please describe the issue.', code: 'DESCRIPTION_REQUIRED' };
  }

  const candidate = await Candidate.findById(candidateId);
  if (!candidate) {
    throw { statusCode: 404, message: 'Candidate not found.', code: 'CANDIDATE_NOT_FOUND' };
  }

  const report = await CandidateReport.create({
    companyId: company._id,
    candidateId: candidate._id,
    type: type || 'OTHER',
    description: description.trim(),
    status: 'Open'
  });

  await logActivity({
    actorId: company.userId,
    actorRole: 'company',
    action: 'REPORT_CREATED',
    entityType: 'Report',
    entityId: report._id,
    metadata: { candidateId: candidate._id, type },
    req
  });

  return report;
}

async function getCompanyReports(companyId, queryParams) {
  const { page, limit, skip } = getPagination(queryParams, 20);

  const [items, total] = await Promise.all([
    CandidateReport.find({ companyId })
      .populate('candidateId', 'fullName phone desiredJobId availabilityStatus')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CandidateReport.countDocuments({ companyId })
  ]);

  return {
    items,
    pagination: formatPagination(total, page, limit)
  };
}

async function getAllReportsForAdmin(queryParams) {
  const { page, limit, skip } = getPagination(queryParams, 20);
  const filter = {};

  if (queryParams.status && queryParams.status !== 'ALL') {
    filter.status = queryParams.status;
  }

  const [items, total] = await Promise.all([
    CandidateReport.find(filter)
      .populate('companyId', 'companyName email phone')
      .populate({
        path: 'candidateId',
        select: 'fullName phone desiredJobId availabilityStatus',
        populate: { path: 'desiredJobId', select: 'name nameAr' }
      })
      .populate('resolvedBy', 'email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CandidateReport.countDocuments(filter)
  ]);

  return {
    items,
    pagination: formatPagination(total, page, limit)
  };
}

async function resolveReport(reportId, adminUser, { status, adminNotes, updateCandidateStatus }, req) {
  const report = await CandidateReport.findById(reportId);
  if (!report) {
    throw { statusCode: 404, message: 'Report not found.', code: 'REPORT_NOT_FOUND' };
  }

  report.status = status || 'Resolved';
  report.adminNotes = adminNotes || report.adminNotes;
  report.resolvedBy = adminUser._id;
  report.resolvedAt = new Date();
  await report.save();

  // If admin chooses to update candidate availability status directly
  if (updateCandidateStatus) {
    await Candidate.findByIdAndUpdate(report.candidateId, {
      availabilityStatus: updateCandidateStatus
    });
  }

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    action: 'REPORT_RESOLVED',
    entityType: 'Report',
    entityId: report._id,
    metadata: { status: report.status },
    req
  });

  return report;
}

module.exports = {
  createReport,
  getCompanyReports,
  getAllReportsForAdmin,
  resolveReport
};
