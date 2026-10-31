const companyService = require('../services/company.service');
const { successResponse } = require('../utils/response');

async function getMyCompany(req, res, next) {
  try {
    const company = await resolveCompanyFromReq(req);
    if (!company) {
      if (req.user && req.user.role === 'admin') {
        return successResponse(res, {
          companyName: 'Asher Jobs Administration',
          subscriptionPlan: 'Platinum',
          subscriptionStatus: 'active',
          verificationStatus: 'Approved'
        }, 'Company profile retrieved (Admin Preview)');
      }
      return errorResponse(res, 'Company profile not found.', 404, 'COMPANY_NOT_FOUND');
    }
    return successResponse(res, company, 'Company profile retrieved');
  } catch (err) {
    next(err);
  }
}

async function updateMyCompany(req, res, next) {
  try {
    const company = await resolveCompanyFromReq(req);
    if (!company) {
      return errorResponse(res, 'Company profile not found.', 404, 'COMPANY_NOT_FOUND');
    }
    const updated = await companyService.updateMyCompanyProfile(company.userId, req.body);
    return successResponse(res, updated, 'Company profile updated successfully');
  } catch (err) {
    next(err);
  }
}

async function getDashboardStats(req, res, next) {
  try {
    const company = await resolveCompanyFromReq(req);
    if (!company) {
      if (req.user && req.user.role === 'admin') {
        return successResponse(res, {
          totalAvailableCandidates: 0,
          requestsCount: 0,
          company: null
        }, 'Company dashboard statistics retrieved (Admin Preview)');
      }
      return errorResponse(res, 'Company profile not found.', 404, 'COMPANY_NOT_FOUND');
    }
    const stats = await companyService.getCompanyDashboardStats(company._id);
    return successResponse(res, stats, 'Company dashboard statistics retrieved');
  } catch (err) {
    next(err);
  }
}

async function suggestJob(req, res, next) {
  try {
    const company = await companyService.getMyCompanyProfile(req.user._id);
    const suggestion = await companyService.suggestJobTitle(company._id, req.body, req);
    return successResponse(
      res,
      suggestion,
      'Job title recommendation submitted to Asher Jobs admin team for review.',
      201
    );
  } catch (err) {
    next(err);
  }
}

async function getEntitlements(req, res, next) {
  try {
    const entitlementService = require('../services/entitlement.service');
    const company = await resolveCompanyFromReq(req);
    if (!company) {
      if (req.user && req.user.role === 'admin') {
        return successResponse(res, {
          plan: 'Platinum',
          planName: 'Platinum VIP (Admin Preview)',
          cartEnabled: true,
          directBrowseEnabled: true,
          dailyLimits: { searches: 999, views: 999, exports: 999 },
          remainingToday: { searches: 999, views: 999, exports: 999 },
          usageToday: { searches: 0, views: 0, exports: 0 },
          planLimits: {
            planName: 'Platinum',
            dailySearchLimit: 30,
            dailyDownloadLimitPerTitle: 6,
            maxCandidatesPerTitle: 10,
            cartEnabled: true,
            platinumBrowseEnabled: true
          },
          limits: {
            planName: 'Platinum',
            dailySearchLimit: 30,
            dailyDownloadLimitPerTitle: 6,
            maxCandidatesPerTitle: 10,
            cartEnabled: true,
            platinumBrowseEnabled: true
          },
          quota: {
            cairoDate: new Date().toISOString().slice(0, 10),
            resetInMs: 3600000,
            searchesUsedToday: 0,
            searchesRemainingToday: 999,
            downloadsByJob: {},
            dailyDownloadLimitPerTitle: 6
          }
        }, 'Entitlement summary retrieved (Admin Preview)');
      }
      return errorResponse(res, 'Company profile not found.', 404, 'COMPANY_NOT_FOUND');
    }

    try {
      const summary = await entitlementService.getAccountEntitlementSummary(company._id);
      return successResponse(res, summary, 'Entitlement summary retrieved');
    } catch (summaryErr) {
      console.warn('[getEntitlements] Summary calculation fallback for company:', company._id, summaryErr.message);
      const isGoldOrPlatinum = ['Gold', 'Platinum'].includes(company.subscriptionPlan);
      const isPlatinum = company.subscriptionPlan === 'Platinum';
      const fallbackLimits = {
        planName: company.subscriptionPlan || 'Basic',
        dailySearchLimit: isPlatinum ? 30 : isGoldOrPlatinum ? 20 : 15,
        dailyDownloadLimitPerTitle: isPlatinum ? 6 : isGoldOrPlatinum ? 4 : 3,
        maxCandidatesPerTitle: 10,
        cartEnabled: isGoldOrPlatinum,
        platinumBrowseEnabled: isPlatinum
      };

      return successResponse(res, {
        company: {
          id: company._id,
          companyName: company.companyName,
          email: company.email,
          subscriptionPlan: company.subscriptionPlan || 'Basic',
          subscriptionStatus: company.subscriptionStatus || 'active',
          verificationStatus: company.verificationStatus || 'Approved'
        },
        plan: company.subscriptionPlan || 'Basic',
        planLimits: fallbackLimits,
        limits: fallbackLimits,
        cairoDate: new Date().toISOString().slice(0, 10),
        quota: {
          cairoDate: new Date().toISOString().slice(0, 10),
          resetInMs: 3600000,
          searchesUsedToday: company.searchesUsed || 0,
          searchesRemainingToday: fallbackLimits.dailySearchLimit,
          downloadsByJob: {},
          dailyDownloadLimitPerTitle: fallbackLimits.dailyDownloadLimitPerTitle
        }
      }, 'Entitlement summary retrieved (Resilient Fallback)');
    }
  } catch (err) {
    console.error('[companyController.getEntitlements fatal error]:', err);
    return successResponse(res, {
      plan: 'Platinum',
      planLimits: {
        planName: 'Platinum',
        dailySearchLimit: 30,
        dailyDownloadLimitPerTitle: 6,
        maxCandidatesPerTitle: 10,
        cartEnabled: true,
        platinumBrowseEnabled: true
      },
      limits: {
        planName: 'Platinum',
        dailySearchLimit: 30,
        dailyDownloadLimitPerTitle: 6,
        maxCandidatesPerTitle: 10,
        cartEnabled: true,
        platinumBrowseEnabled: true
      },
      quota: {
        cairoDate: new Date().toISOString().slice(0, 10),
        resetInMs: 3600000,
        searchesUsedToday: 0,
        searchesRemainingToday: 30,
        downloadsByJob: {},
        dailyDownloadLimitPerTitle: 6
      }
    }, 'Entitlement summary retrieved (Emergency Fallback)');
  }
}

async function resolveCompanyFromReq(req) {
  if (req.company) return req.company;
  if (!req.user) return null;
  const Company = require('../models/Company');
  const comp = await Company.findOne({ userId: req.user._id, isDeleted: false });
  return comp || null;
}

async function getCart(req, res, next) {
  try {
    const cartService = require('../services/cart.service');
    const company = await resolveCompanyFromReq(req);
    if (!company) {
      if (req.user && req.user.role === 'admin') {
        return successResponse(res, { companyId: req.user._id, items: [] }, 'Candidate cart retrieved (Admin Preview)');
      }
      return successResponse(res, { companyId: req.user?._id, items: [] }, 'Candidate cart retrieved (Empty)');
    }
    const cart = await cartService.getCart(company._id);
    return successResponse(res, cart, 'Candidate cart retrieved');
  } catch (err) {
    console.error('[companyController.getCart error]:', err);
    return successResponse(res, { companyId: req.user?._id, items: [] }, 'Candidate cart retrieved (Fallback)');
  }
}

async function addOrUpdateCart(req, res, next) {
  try {
    const cartService = require('../services/cart.service');
    const company = await resolveCompanyFromReq(req);
    if (!company) {
      if (req.user && req.user.role === 'admin') {
        return errorResponse(res, 'يرجى تسجيل الدخول بحساب صاحب عمل لإدارة السلة.', 403, 'FORBIDDEN_ADMIN_CART');
      }
      return errorResponse(res, 'Company profile not found.', 404, 'COMPANY_NOT_FOUND');
    }
    const updated = await cartService.addOrUpdateCartItem(company, req.body);
    return successResponse(res, updated, 'Candidate cart updated successfully');
  } catch (err) {
    next(err);
  }
}

async function removeCartItem(req, res, next) {
  try {
    const cartService = require('../services/cart.service');
    const company = await resolveCompanyFromReq(req);
    if (!company) {
      return successResponse(res, { items: [] }, 'Item removed from cart');
    }
    const updated = await cartService.removeCartItem(company._id, req.params.itemId);
    return successResponse(res, updated, 'Item removed from cart');
  } catch (err) {
    next(err);
  }
}

async function clearCart(req, res, next) {
  try {
    const cartService = require('../services/cart.service');
    const company = await resolveCompanyFromReq(req);
    if (!company) {
      return successResponse(res, { items: [] }, 'Cart cleared');
    }
    const updated = await cartService.clearCart(company._id);
    return successResponse(res, updated, 'Cart cleared');
  } catch (err) {
    next(err);
  }
}

async function exportCart(req, res, next) {
  try {
    const cartService = require('../services/cart.service');
    const company = await resolveCompanyFromReq(req);
    if (!company) {
      return errorResponse(res, 'Company profile not found.', 404, 'COMPANY_NOT_FOUND');
    }
    const { buffer, filename, contentType } = await cartService.exportCartExcel(company, req.body, req);

    res.setHeader('Content-Type', contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    return res.status(200).send(buffer);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMyCompany,
  updateMyCompany,
  getDashboardStats,
  suggestJob,
  getEntitlements,
  getCart,
  addOrUpdateCart,
  removeCartItem,
  clearCart,
  exportCart
};
