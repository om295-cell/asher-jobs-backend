const companyService = require('../services/company.service');
const { successResponse } = require('../utils/response');

async function getMyCompany(req, res, next) {
  try {
    const company = await companyService.getMyCompanyProfile(req.user._id);
    return successResponse(res, company, 'Company profile retrieved');
  } catch (err) {
    next(err);
  }
}

async function updateMyCompany(req, res, next) {
  try {
    const company = await companyService.updateMyCompanyProfile(req.user._id, req.body);
    return successResponse(res, company, 'Company profile updated successfully');
  } catch (err) {
    next(err);
  }
}

async function getDashboardStats(req, res, next) {
  try {
    const company = await companyService.getMyCompanyProfile(req.user._id);
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
    const company = await companyService.getMyCompanyProfile(req.user._id);
    const summary = await entitlementService.getAccountEntitlementSummary(company._id);
    return successResponse(res, summary, 'Entitlement summary retrieved');
  } catch (err) {
    next(err);
  }
}

async function getCart(req, res, next) {
  try {
    const cartService = require('../services/cart.service');
    const company = await companyService.getMyCompanyProfile(req.user._id);
    const cart = await cartService.getCart(company._id);
    return successResponse(res, cart, 'Candidate cart retrieved');
  } catch (err) {
    next(err);
  }
}

async function addOrUpdateCart(req, res, next) {
  try {
    const cartService = require('../services/cart.service');
    const company = await companyService.getMyCompanyProfile(req.user._id);
    const updated = await cartService.addOrUpdateCartItem(company, req.body);
    return successResponse(res, updated, 'Candidate cart updated successfully');
  } catch (err) {
    next(err);
  }
}

async function removeCartItem(req, res, next) {
  try {
    const cartService = require('../services/cart.service');
    const company = await companyService.getMyCompanyProfile(req.user._id);
    const updated = await cartService.removeCartItem(company._id, req.params.itemId);
    return successResponse(res, updated, 'Item removed from cart');
  } catch (err) {
    next(err);
  }
}

async function clearCart(req, res, next) {
  try {
    const cartService = require('../services/cart.service');
    const company = await companyService.getMyCompanyProfile(req.user._id);
    const updated = await cartService.clearCart(company._id);
    return successResponse(res, updated, 'Cart cleared');
  } catch (err) {
    next(err);
  }
}

async function exportCart(req, res, next) {
  try {
    const cartService = require('../services/cart.service');
    const company = await companyService.getMyCompanyProfile(req.user._id);
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
