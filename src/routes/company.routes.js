const express = require('express');
const router = express.Router();
const companyController = require('../controllers/company.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

router.get('/me', authenticate, authorize('company'), companyController.getMyCompany);
router.put('/me', authenticate, authorize('company'), companyController.updateMyCompany);
router.get('/me/dashboard', authenticate, authorize('company'), companyController.getDashboardStats);
router.post('/job-suggestions', authenticate, authorize('company'), companyController.suggestJob);

module.exports = router;
