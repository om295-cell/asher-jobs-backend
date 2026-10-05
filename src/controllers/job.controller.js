const adminService = require('../services/admin.service');
const { successResponse } = require('../utils/response');

async function getJobs(req, res, next) {
  try {
    const jobs = await adminService.getAllJobs(false);
    return successResponse(res, jobs, 'Active jobs retrieved');
  } catch (err) {
    next(err);
  }
}

async function getCategories(req, res, next) {
  try {
    const categories = await adminService.getAllCategories(false);
    return successResponse(res, categories, 'Active categories retrieved');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getJobs,
  getCategories
};
