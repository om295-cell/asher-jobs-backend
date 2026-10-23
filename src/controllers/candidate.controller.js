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

/**
 * Validates document magic bytes (file signature) to prevent MIME-type spoofing
 */
function validateFileSignature(filePath) {
  try {
    const buffer = Buffer.alloc(8);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    // PDF signature: %PDF (0x25 0x50 0x44 0x46)
    const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
    // DOCX (ZIP format) signature: PK\x03\x04 (0x50 0x4B 0x03 0x04)
    const isDocx = buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
    // DOC (OLE compound document) signature: D0 CF 11 E0 A1 B1 1A E1
    const isDoc = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;

    return isPdf || isDocx || isDoc;
  } catch (err) {
    return false;
  }
}

async function uploadCv(req, res, next) {
  try {
    if (!req.file) {
      return errorResponse(res, 'Please select a valid CV document (PDF, DOC, DOCX).', 400, 'NO_FILE');
    }

    // OWASP A08: Verify real file header signatures (magic bytes) to prevent extension/MIME spoofing
    if (!validateFileSignature(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {}
      return errorResponse(
        res,
        'Invalid document file signature. The file header does not match a legitimate PDF, DOC, or DOCX document.',
        400,
        'INVALID_FILE_SIGNATURE'
      );
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

    if (req.user.mustChangePassword) {
      return errorResponse(
        res,
        'You must change your temporary password before accessing candidate CVs.',
        403,
        'PASSWORD_CHANGE_REQUIRED'
      );
    }

    if (req.user.role === 'candidate') {
      candidate = await Candidate.findOne({ userId: req.user._id });
    } else if (req.user.role === 'admin') {
      candidate = await Candidate.findById(id);
    } else if (req.user.role === 'company') {
      if (req.user.mustChangePassword) {
        return errorResponse(
          res,
          'You must change your temporary password before accessing candidate CVs.',
          403,
          'PASSWORD_CHANGE_REQUIRED'
        );
      }
      const Company = require('../models/Company');
      const company = req.company || await Company.findOne({ userId: req.user._id, isDeleted: false });
      if (!company || company.verificationStatus !== 'Approved') {
        return errorResponse(res, 'Only approved companies can download candidate CVs.', 403, 'COMPANY_NOT_APPROVED');
      }
      if (company.isBlocked) {
        return errorResponse(res, 'Company account is blocked.', 403, 'COMPANY_BLOCKED');
      }
      if (company.accountStatus === 'suspended') {
        return errorResponse(res, 'Company account is suspended. Candidate CV access is denied.', 403, 'COMPANY_SUSPENDED');
      }
      if (company.accountStatus === 'on_hold') {
        return errorResponse(res, 'Company account is on hold. Candidate CV access is denied.', 403, 'COMPANY_ON_HOLD');
      }
      if (company.accountStatus && company.accountStatus !== 'active') {
        return errorResponse(res, 'Company account is not active. Candidate CV access is denied.', 403, 'COMPANY_NOT_ACTIVE');
      }
      const isExpired =
        company.subscriptionStatus !== 'active' ||
        (company.subscriptionEndDate && new Date(company.subscriptionEndDate) < new Date());
      if (isExpired) {
        return errorResponse(
          res,
          'An active subscription plan is required to download candidate CVs. Please renew your subscription.',
          403,
          'SUBSCRIPTION_EXPIRED'
        );
      }
      const entitlementService = require('../services/entitlement.service');
      await entitlementService.checkAndConsumeDownloadQuota(company._id, 'cv_download', 1, req);
      candidate = await Candidate.findOne({ _id: id, accountStatus: 'active', isDeleted: false });
    } else {
      return errorResponse(res, 'Access denied.', 403, 'ACCESS_DENIED');
    }

    if (!candidate || !candidate.cvUrl) {
      return errorResponse(res, 'CV file not found or has not been uploaded.', 404, 'CV_NOT_FOUND');
    }

    const resolvedPath = path.resolve(candidate.cvUrl);
    const os = require('os');
    const allowedBaseDirs = [
      path.resolve(process.cwd(), 'uploads'),
      path.resolve(os.tmpdir())
    ];
    const isInsideAllowedDir = allowedBaseDirs.some((dir) => resolvedPath.startsWith(dir));
    if (!isInsideAllowedDir || !fs.existsSync(resolvedPath)) {
      return errorResponse(res, 'CV file not found on storage.', 404, 'CV_NOT_FOUND');
    }

    return res.download(resolvedPath, candidate.cvOriginalName || 'candidate_cv.pdf');
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
    const isCompany = !!req.company && req.user?.role !== 'admin';
    let quotaInfo = null;

    if (isCompany) {
      const entitlementService = require('../services/entitlement.service');
      quotaInfo = await entitlementService.checkAndConsumeSearchQuota(req.company._id, req);
    }

    // Bound each company response by its plan allowance, even when the caller
    // supplies a larger `limit` in the query string.
    const searchQuery = { ...req.query };
    if (isCompany && quotaInfo?.planLimits?.maxCandidatesPerTitle) {
      const requestedLimit = Number.parseInt(searchQuery.limit, 10);
      const boundedLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20;
      searchQuery.limit = String(Math.min(boundedLimit, quotaInfo.planLimits.maxCandidatesPerTitle));
    }

    const result = await searchService.searchCandidates(searchQuery, req.company, req);
    const pagination = { ...result.pagination, quota: quotaInfo };
    return successResponse(res, result.items, 'Candidates retrieved successfully', 200, pagination);
  } catch (err) {
    next(err);
  }
}

async function getCandidateById(req, res, next) {
  try {
    if (req.company) {
      const entitlementService = require('../services/entitlement.service');
      await entitlementService.checkAndConsumeSearchQuota(req.company._id, req);
    }
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

      // SEC-30: Enforce daily download quota per job title.
      // When no jobId/desiredJobId is supplied (e.g. admin-only or unfiltered export),
      // use the 'ALL_TITLES' bucket so the quota is never silently skipped.
      const targetJobId = req.query.jobId || req.query.desiredJobId || 'ALL_TITLES';
      const entitlementService = require('../services/entitlement.service');
      await entitlementService.checkAndConsumeDownloadQuota(req.company._id, targetJobId, 1, req);
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

/**
 * Dedicated Platinum Candidate Database Browsing (Unlimited browsing with filters)
 * SEC-37: Contact details (phone, email) are stripped from browse results.
 * Contacts are only accessible through the single-candidate detail route.
 * Page size is capped at 20 to prevent bulk harvesting.
 */
async function browseCandidatesPlatinum(req, res, next) {
  try {
    const entitlementService = require('../services/entitlement.service');

    // SEC-29 (defence-in-depth)
    await entitlementService.validateCompanyAccess(req.company._id);

    const planLimits = await entitlementService.getPlanLimits(req.company?.subscriptionPlan);

    if (!planLimits.platinumBrowseEnabled) {
      return errorResponse(
        res,
        'خاصية تصفح قاعدة بيانات المرشحين متاحة حصرياً لمشتركي الباقة البلاتينية (Platinum).',
        403,
        'PLATINUM_REQUIRED'
      );
    }

    // SEC-37: Cap page size at 20 for Platinum browse to prevent bulk contact harvest
    const safeQuery = { ...req.query, limit: Math.min(parseInt(req.query.limit, 10) || 20, 20) };
    const result = await searchService.searchCandidates(safeQuery, req.company, req);

    // SEC-37: Strip phone and email from browse list — contacts only available via /:id detail route
    const sanitized = result.items.map(({ phone, email, ...rest }) => rest);
    return successResponse(res, sanitized, 'Platinum candidate browsing results', 200, result.pagination);
  } catch (err) {
    next(err);
  }
}

/**
 * Platinum Single Candidate View (Strictly 1 candidate at a time)
 * SEC-43: Consumes the daily search quota so detail views can't bypass the
 * per-session rate limit that browse enforces at the aggregate level.
 */
async function getPlatinumCandidateDetail(req, res, next) {
  try {
    const entitlementService = require('../services/entitlement.service');

    // SEC-43: enforce search quota so /:id detail can't be used to bypass the browse limiter
    await entitlementService.checkAndConsumeSearchQuota(req.company._id, req);
    await entitlementService.recordPlatinumCandidateAction(req.company._id, req.params.id, 'view', req);

    const candidate = await candidateService.getCandidateByIdForCompany(req.params.id, req.company, req);
    return successResponse(res, candidate, 'Platinum single candidate details retrieved');
  } catch (err) {
    next(err);
  }
}

/**
 * Platinum Single Candidate Download (Strictly 1 candidate at a time)
 */
async function downloadPlatinumCandidateExcel(req, res, next) {
  try {
    const entitlementService = require('../services/entitlement.service');
    await entitlementService.recordPlatinumCandidateAction(req.company._id, req.params.id, 'download', req);

    const query = { candidateIds: [req.params.id], limit: 1 };
    const buffer = await exportService.exportCandidatesXLSX(query, req.company, req);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="platinum_candidate_${req.params.id}.xlsx"`);
    return res.send(buffer);
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
  recordCandidateInteraction,
  browseCandidatesPlatinum,
  getPlatinumCandidateDetail,
  downloadPlatinumCandidateExcel
};
