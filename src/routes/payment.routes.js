const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { requireApprovedCompany } = require('../middleware/companyApproval.middleware');
const { requirePasswordChanged } = require('../middleware/mustChangePassword.middleware');
const { paymentInitiateLimiter } = require('../middleware/rateLimit.middleware');

// ── Public: plan listing (companies see plans before logging in) ──
router.get('/plans', paymentController.listPlans);

// ── Payment webhooks (no auth — called server-to-server by Fawry / Paymob) ──
router.post('/webhook', paymentController.handleWebhook);
router.post('/fawry/webhook', paymentController.handleWebhook);

// ── Payment browser redirect callbacks (no auth) ──
router.get('/callback', paymentController.handleCallback);
router.get('/fawry/callback', paymentController.handleCallback);

// ── Authenticated company routes ──
router.use(authenticate, authorize('company'), requirePasswordChanged, requireApprovedCompany);

router.post('/initiate', paymentInitiateLimiter, paymentController.initiatePayment);
router.get('/my-orders', paymentController.getMyOrders);

module.exports = router;
