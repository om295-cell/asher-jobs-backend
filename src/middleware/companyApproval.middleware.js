const Company = require('../models/Company');
const { errorResponse } = require('../utils/response');

async function requireApprovedCompany(req, res, next) {
  try {
    if (!req.user) {
      return errorResponse(res, 'Authentication required.', 401, 'AUTH_REQUIRED');
    }

    // Admins can bypass company checks
    if (req.user.role === 'admin') {
      return next();
    }

    if (req.user.role !== 'company') {
      return errorResponse(res, 'Access restricted to approved company accounts.', 403, 'FORBIDDEN');
    }

    const company = await Company.findOne({ userId: req.user._id, isDeleted: false });

    if (!company) {
      return errorResponse(res, 'Company profile not found.', 404, 'COMPANY_NOT_FOUND');
    }

    if (company.isBlocked) {
      return errorResponse(
        res,
        company.blockReason ? `Company account blocked: ${company.blockReason}` : 'Company account has been blocked.',
        403,
        'COMPANY_BLOCKED'
      );
    }

    if (company.verificationStatus === 'Pending') {
      return errorResponse(
        res,
        'Your company account is pending review by Asher Jobs administrators.',
        403,
        'COMPANY_PENDING_APPROVAL'
      );
    }

    if (company.verificationStatus === 'Rejected') {
      return errorResponse(
        res,
        company.rejectionReason
          ? `Company registration was not approved: ${company.rejectionReason}`
          : 'Your company registration was not approved. Please contact Asher Jobs.',
        403,
        'COMPANY_REJECTED'
      );
    }

    if (company.verificationStatus !== 'Approved') {
      return errorResponse(
        res,
        `Company account status is ${company.verificationStatus}. Candidate database access is not permitted.`,
        403,
        'COMPANY_NOT_APPROVED'
      );
    }

    req.company = company;
    next();
  } catch (err) {
    return errorResponse(res, 'Error verifying company status: ' + err.message, 500, 'SERVER_ERROR');
  }
}

module.exports = {
  requireApprovedCompany
};
