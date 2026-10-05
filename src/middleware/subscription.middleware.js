const { errorResponse } = require('../utils/response');

function requireActiveSubscription(options = {}) {
  return (req, res, next) => {
    // Admin bypass
    if (req.user && req.user.role === 'admin') {
      return next();
    }

    const company = req.company;
    if (!company) {
      return errorResponse(res, 'Company context required.', 403, 'COMPANY_REQUIRED');
    }

    // Check status
    if (company.subscriptionStatus !== 'active') {
      return errorResponse(
        res,
        'Your company subscription is inactive. Candidate search and exports are currently unavailable.',
        403,
        'SUBSCRIPTION_REQUIRED'
      );
    }

    // Check expiration date
    if (company.subscriptionEndDate && new Date(company.subscriptionEndDate) < new Date()) {
      return errorResponse(
        res,
        'Your company subscription has expired. Please contact Asher Jobs to renew.',
        403,
        'SUBSCRIPTION_EXPIRED'
      );
    }

    // Check export limit if checking export
    if (options.checkExportLimit && company.exportsUsed >= company.exportLimit) {
      return errorResponse(
        res,
        `You have reached your monthly export limit (${company.exportLimit} exports).`,
        429,
        'EXPORT_LIMIT_REACHED'
      );
    }

    // Check search limit if checking search
    if (options.checkSearchLimit && company.searchesUsed >= company.searchLimit) {
      return errorResponse(
        res,
        `You have reached your monthly search limit (${company.searchLimit} searches).`,
        429,
        'SEARCH_LIMIT_REACHED'
      );
    }

    next();
  };
}

module.exports = {
  requireActiveSubscription
};
