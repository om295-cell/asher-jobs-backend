const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const recommendationController = require('../controllers/recommendation.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

// Anti-abuse rate limiters
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'تم تجاوز الحد المسموح به من الطلبات. يرجى الانتظار قليلاً والمحاولة لاحقاً.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

const checkPhoneLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 45,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'يرجى التمهل في التحقق من أرقام الهواتف.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

const trackLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'يرجى الانتظار قليلاً قبل إعادة الاستعلام.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

// Public endpoints
router.post('/check-phone', checkPhoneLimiter, recommendationController.checkPhone);
router.post('/', submitLimiter, recommendationController.submitRecommendation);
router.get('/track/:requestNumber', trackLimiter, recommendationController.trackStatus);

// Admin endpoints
router.get('/admin', authenticate, authorize('admin'), recommendationController.adminList);
router.get('/admin/:id', authenticate, authorize('admin'), recommendationController.adminGet);
router.patch('/admin/:id/status', authenticate, authorize('admin'), recommendationController.adminUpdateStatus);

module.exports = router;
