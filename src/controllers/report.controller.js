const reportService = require('../services/report.service');
const { successResponse } = require('../utils/response');

async function createReport(req, res, next) {
  try {
    const report = await reportService.createReport(req.company, req.body, req);
    return successResponse(res, report, 'Report submitted successfully. Thank you for helping keep candidate records accurate.', 201);
  } catch (err) {
    next(err);
  }
}

async function getCompanyReports(req, res, next) {
  try {
    const result = await reportService.getCompanyReports(req.company._id, req.query);
    return successResponse(res, result.items, 'Company reports retrieved', 200, result.pagination);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createReport,
  getCompanyReports
};
