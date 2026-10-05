const path = require('path');
const fs = require('fs');
const candidateService = require('../services/candidate.service');
const searchService = require('../services/search.service');
const exportService = require('../services/export.service');
const recruitmentRequestService = require('../services/recruitmentRequest.service');
const Candidate = require('../models/Candidate');
const { successResponse, errorResponse } = require('../utils/response');

async function getMyProfile(req, res, next) {
  try {
    const profile = await candidateService.getMyCandidateProfile(req.user._id);
    return successResponse(res, profile, 'Candidate profile retrieved');
  } catch (err) {
    next(err);
  }
}

async function updateMyProfile(req, res, next) {
  try {
    const profile = await candidateService.updateMyCandidateProfile(req.user._id, req.body);
    return successResponse(res, profile, 'Candidate profile updated successfully');
  } catch (err) {
    next(err);
  }
}

async function updateAvailability(req, res, next) {
  try {
    const { availabilityStatus } = req.body;
    const profile = await candidateService.updateAvailability(req.user._id, availabilityStatus);
    return successResponse(res, profile, 'Availability status updated successfully');
  } catch (err) {
    next(err);
  }
}

async function uploadCv(req, res, next) {
  try {
    if (!req.file) {
      return errorResponse(res, 'Please select a valid CV document (PDF, DOC, DOCX).', 400, 'NO_FILE');
    }
    const result = await candidateService.attachCv(req.user._id, req.file);
    return successResponse(res, result, 'CV uploaded successfully');
  } catch (err) {
    next(err);
  }
}

async function deleteCv(req, res, next) {
  try {
    await candidateService.deleteCv(req.user._id);
    return successResponse(res, null, 'CV removed successfully');
  } catch (err) {
    next(err);
  }
}

async function downloadCv(req, res, next) {
  try {
    const { id } = req.params;
    let candidate = null;

    if (req.user.role === 'candidate') {
      candidate = await Candidate.findOne({ userId: req.user._id });
    } else if (req.user.role === 'admin' || (req.user.role === 'company' && req.company)) {
      candidate = await Candidate.findById(id);
    }

    if (!candidate || !candidate.cvUrl || !fs.existsSync(candidate.cvUrl)) {
      return errorResponse(res, 'CV file not found or has not been uploaded.', 404, 'CV_NOT_FOUND');
    }

    return res.download(candidate.cvUrl, candidate.cvOriginalName || 'candidate_cv.pdf');
  } catch (err) {
    next(err);
  }
}

async function deactivateProfile(req, res, next) {
  try {
    const result = await candidateService.deactivateMyCandidate(req.user._id);
    return successResponse(res, result, 'Candidate profile deactivated successfully');
  } catch (err) {
    next(err);
  }
}

async function getMyReferrals(req, res, next) {
  try {
    const stats = await candidateService.getCandidateReferralStats(req.user._id);
    return successResponse(res, stats, 'Referral statistics retrieved');
  } catch (err) {
    next(err);
  }
}

async function searchCandidates(req, res, next) {
  try {
    const result = await searchService.searchCandidates(req.query, req.company, req);
    return successResponse(res, result.items, 'Candidates retrieved successfully', 200, result.pagination);
  } catch (err) {
    next(err);
  }
}

async function getCandidateById(req, res, next) {
  try {
    const candidate = await candidateService.getCandidateByIdForCompany(req.params.id, req.company, req);
    return successResponse(res, candidate, 'Candidate details retrieved');
  } catch (err) {
    next(err);
  }
}

async function exportCandidates(req, res, next) {
  try {
    const isCompany = !!req.company && req.user?.role !== 'admin';

    // If a company explicitly requests more than 10 records, reject with clear error
    if (isCompany) {
      if (req.query.limit && parseInt(req.query.limit, 10) > 10) {
        return errorResponse(
          res,
          'Companies cannot download a file that contains more than 10 candidates at once.',
          400,
          'EXPORT_BATCH_LIMIT_EXCEEDED'
        );
      }
      if (req.query.candidateIds) {
        const ids = Array.isArray(req.query.candidateIds)
          ? req.query.candidateIds
          : String(req.query.candidateIds).split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length > 10) {
          return errorResponse(
            res,
            'Companies cannot download a file that contains more than 10 candidates at once.',
            400,
            'EXPORT_BATCH_LIMIT_EXCEEDED'
          );
        }
      }
    }

    const format = req.query.format || 'csv';

    if (format === 'xlsx') {
      const buffer = await exportService.exportCandidatesXLSX(req.query, req.company, req);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="asher_jobs_candidates.xlsx"');
      return res.send(buffer);
    } else {
      const csvData = await exportService.exportCandidatesCSV(req.query, req.company, req);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="asher_jobs_candidates.csv"');
      return res.send(csvData);
    }
  } catch (err) {
    next(err);
  }
}

async function recordCandidateInteraction(req, res, next) {
  try {
    const { action, notes, requestId } = req.body;
    const { id: candidateId } = req.params;

    const interaction = await recruitmentRequestService.logCandidateInteraction(
      req.company._id,
      candidateId,
      action,
      notes,
      requestId
    );

    return successResponse(res, interaction, 'Candidate interaction recorded successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMyProfile,
  updateMyProfile,
  updateAvailability,
  uploadCv,
  deleteCv,
  downloadCv,
  deactivateProfile,
  getMyReferrals,
  searchCandidates,
  getCandidateById,
  exportCandidates,
  recordCandidateInteraction
};
