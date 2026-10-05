const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

// All admin routes require authentication and role === 'admin'
router.use(authenticate, authorize('admin'));

// Dashboard
router.get('/dashboard', adminController.getDashboard);

// Candidates Management
router.get('/candidates', adminController.listCandidates);
router.get('/candidates/:id', adminController.getCandidate);
router.put('/candidates/:id', adminController.updateCandidate);
router.patch('/candidates/:id/status', adminController.updateCandidateStatus);
router.patch('/candidates/:id/block', adminController.toggleBlockCandidate);
router.delete('/candidates/:id', adminController.deleteCandidate);

// Companies Management & Approval
router.get('/companies', adminController.listCompanies);
router.get('/companies/:id', adminController.getCompany);
router.patch('/companies/:id/approve', adminController.approveCompany);
router.patch('/companies/:id/reject', adminController.rejectCompany);
router.patch('/companies/:id/block', adminController.toggleBlockCompany);
router.patch('/companies/:id/subscription', adminController.updateCompanySubscription);

// Recruitment Requests Management
router.get('/requests', adminController.listRequests);
router.patch('/requests/:id/status', adminController.updateRequestStatus);

// Jobs Management
router.get('/jobs', adminController.listJobs);
router.post('/jobs', adminController.createJob);
router.put('/jobs/:id', adminController.updateJob);
router.delete('/jobs/:id', adminController.deleteJob);

// Categories Management
router.get('/categories', adminController.listCategories);
router.post('/categories', adminController.createCategory);
router.put('/categories/:id', adminController.updateCategory);
router.delete('/categories/:id', adminController.deleteCategory);

// Reports Management
router.get('/reports', adminController.listReports);
router.patch('/reports/:id', adminController.resolveReport);

// Activity Logs
router.get('/activity', adminController.listActivityLogs);

// System Settings
router.get('/settings', adminController.getSettings);
router.put('/settings', adminController.updateSetting);

module.exports = router;
