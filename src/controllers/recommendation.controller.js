const recommendationService = require('../services/recommendation.service');
const { successResponse, errorResponse } = require('../utils/response');

/**
 * POST /api/recommendations/check-phone
 * Public endpoint to check phone availability in real-time
 */
async function checkPhone(req, res, next) {
  try {
    const { phone } = req.body;
    if (!phone) {
      return errorResponse(res, 'رقم الهاتف مطلوب للتحقق منه', 400, 'PHONE_REQUIRED');
    }

    const result = await recommendationService.checkPhoneAvailability(phone);
    return successResponse(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/recommendations
 * Submit a complete group recommendation (11 persons)
 */
async function submitRecommendation(req, res, next) {
  try {
    const { people, legalAccepted } = req.body;
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    const userAgent = req.headers['user-agent'] || '';

    const result = await recommendationService.submitRecommendationRequest({
      people,
      legalAccepted,
      ip,
      userAgent
    });

    return successResponse(
      res,
      result,
      'تم إرسال طلب الترشيحات بنجاح وهو الآن قيد المراجعة والتدقيق.',
      201
    );
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/recommendations/track/:requestNumber
 * Track status by request number
 */
async function trackStatus(req, res, next) {
  try {
    const { requestNumber } = req.params;
    const { phone } = req.query;

    const result = await recommendationService.trackRequestStatus(requestNumber, phone);
    return successResponse(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/recommendations/admin
 * Admin: List all requests
 */
async function adminList(req, res, next) {
  try {
    const { page, limit, status, search } = req.query;
    const result = await recommendationService.adminListRequests({ page, limit, status, search });
    return res.status(200).json({
      success: true,
      data: result.requests,
      pagination: result.pagination,
      statusCounts: result.statusCounts
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/recommendations/admin/:id
 * Admin: Get single request
 */
async function adminGet(req, res, next) {
  try {
    const { id } = req.params;
    const result = await recommendationService.adminGetRequestById(id);
    return successResponse(res, result);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/recommendations/admin/:id/status
 * Admin: Approve or Reject request
 */
async function adminUpdateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;
    const adminUserId = req.user?._id;

    const result = await recommendationService.adminUpdateRequestStatus(
      id,
      { status, adminNotes },
      adminUserId
    );

    const message = status === 'approved'
      ? 'تم قبول واعتماد الطلب بنجاح'
      : 'تم تحديث حالة الطلب';

    return successResponse(res, result, message);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  checkPhone,
  submitRecommendation,
  trackStatus,
  adminList,
  adminGet,
  adminUpdateStatus
};
