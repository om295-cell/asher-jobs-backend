const express = require('express');
const router = express.Router();
const recruitmentRequestController = require('../controllers/recruitmentRequest.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireApprovedCompany } = require('../middleware/companyApproval.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { requirePasswordChanged } = require('../middleware/mustChangePassword.middleware');

router.post(
  '/',
  authenticate,
  requirePasswordChanged,    // SEC-33: block temp-password accounts
  requireApprovedCompany,
  requireActiveSubscription(),
  recruitmentRequestController.createRequest
);

router.get(
  '/',
  authenticate,
  requirePasswordChanged,    // SEC-33
  requireApprovedCompany,
  recruitmentRequestController.getMyRequests
);

router.get(
  '/:id',
  authenticate,
  requirePasswordChanged,    // SEC-33
  requireApprovedCompany,
  recruitmentRequestController.getRequestById
);

module.exports = router;
