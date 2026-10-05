const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireApprovedCompany } = require('../middleware/companyApproval.middleware');

router.post(
  '/',
  authenticate,
  requireApprovedCompany,
  reportController.createReport
);

router.get(
  '/',
  authenticate,
  requireApprovedCompany,
  reportController.getCompanyReports
);

module.exports = router;
