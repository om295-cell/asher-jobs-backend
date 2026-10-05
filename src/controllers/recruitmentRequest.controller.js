const recruitmentRequestService = require('../services/recruitmentRequest.service');
const { successResponse } = require('../utils/response');

async function createRequest(req, res, next) {
  try {
    const result = await recruitmentRequestService.createRecruitmentRequest(req.company, req.body, req);
    return successResponse(
      res,
      result,
      `Recruitment request created. Found and matched ${result.totalMatched} candidates.`,
      201
    );
  } catch (err) {
    next(err);
  }
}

async function getMyRequests(req, res, next) {
  try {
    const result = await recruitmentRequestService.getCompanyRecruitmentRequests(req.company._id, req.query);
    return successResponse(res, result.items, 'Recruitment requests retrieved', 200, result.pagination);
  } catch (err) {
    next(err);
  }
}

async function getRequestById(req, res, next) {
  try {
    const isAdmin = req.user.role === 'admin';
    const companyId = req.company ? req.company._id : null;
    const reqDoc = await recruitmentRequestService.getRecruitmentRequestById(req.params.id, companyId, isAdmin);
    return successResponse(res, reqDoc, 'Recruitment request retrieved');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createRequest,
  getMyRequests,
  getRequestById
};
