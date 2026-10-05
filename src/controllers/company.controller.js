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

module.exports = {
  getMyCompany,
  updateMyCompany,
  getDashboardStats,
  suggestJob
};
