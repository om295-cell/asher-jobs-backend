const express = require('express');
const router = express.Router();
const recruitmentRequestController = require('../controllers/recruitmentRequest.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireApprovedCompany } = require('../middleware/companyApproval.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');

router.post(
  '/',
  authenticate,
  requireApprovedCompany,
  requireActiveSubscription(),
  recruitmentRequestController.createRequest
);

router.get(
  '/',
  authenticate,
  requireApprovedCompany,
  recruitmentRequestController.getMyRequests
);

router.get(
  '/:id',
  authenticate,
  recruitmentRequestController.getRequestById
);

module.exports = router;
