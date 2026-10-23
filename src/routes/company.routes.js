const express = require('express');
const router = express.Router();
const companyController = require('../controllers/company.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

const { requireApprovedCompany } = require('../middleware/companyApproval.middleware');
const { requirePasswordChanged } = require('../middleware/mustChangePassword.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');

router.use(authenticate, authorize('company'), requirePasswordChanged);

router.get('/me', companyController.getMyCompany);
router.put('/me', companyController.updateMyCompany);
router.get('/me/dashboard', companyController.getDashboardStats);
router.post('/job-suggestions', companyController.suggestJob);

// Entitlements & Quotas
router.get('/entitlements', requireApprovedCompany, companyController.getEntitlements);

// Multi-title Candidate Cart (Gold & Platinum)
router.get('/cart', requireApprovedCompany, companyController.getCart);
router.post('/cart', requireApprovedCompany, companyController.addOrUpdateCart);
router.delete('/cart/:itemId', requireApprovedCompany, companyController.removeCartItem);
router.delete('/cart', requireApprovedCompany, companyController.clearCart);
router.post('/cart/export', requireApprovedCompany, requireActiveSubscription({ checkExportLimit: true }), companyController.exportCart);

module.exports = router;
