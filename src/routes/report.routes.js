const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireApprovedCompany } = require('../middleware/companyApproval.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { requirePasswordChanged } = require('../middleware/mustChangePassword.middleware');

router.post(
  '/',
  authenticate,
  requirePasswordChanged,        // SEC-41: block temp-password accounts
  requireApprovedCompany,
  requireActiveSubscription(),   // SEC-41: block expired/inactive subscriptions
  reportController.createReport
);

router.get(
  '/',
  authenticate,
  requirePasswordChanged,        // SEC-41
  requireApprovedCompany,
  requireActiveSubscription(),   // SEC-41
  reportController.getCompanyReports
);

module.exports = router;
