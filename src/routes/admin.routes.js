const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const jobTitleReviewController = require('../controllers/jobTitleReview.controller');
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

const multer = require('multer');
const uploadTitleDoc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

// Persisted Super Admin review queue. Every imported title receives its own
// database record; uploading a file is never handled as one DB transaction.
router.post('/job-title-batches/manual', jobTitleReviewController.createManualBatch);
router.post('/job-title-batches/file', uploadTitleDoc.single('file'), jobTitleReviewController.createFileBatch);
router.get('/job-title-batches', jobTitleReviewController.listBatches);
router.get('/job-title-batches/:id', jobTitleReviewController.getBatch);
router.get('/job-title-reviews', jobTitleReviewController.listReviews);
router.post('/job-title-reviews/bulk-reject', jobTitleReviewController.bulkRejectReviews);
router.delete('/job-title-reviews', jobTitleReviewController.deleteAllArchivedReviews);
router.get('/job-title-reviews/:id', jobTitleReviewController.getReview);
router.patch('/job-title-reviews/:id', jobTitleReviewController.editReview);
router.post('/job-title-reviews/:id/approve', jobTitleReviewController.approveReview);
router.post('/job-title-reviews/:id/reject', jobTitleReviewController.rejectReview);
router.post('/job-title-reviews/:id/retry', jobTitleReviewController.retryReview);
router.delete('/job-title-reviews/:id', jobTitleReviewController.deleteArchivedReview);

// Jobs Management & Title Extraction
router.get('/jobs', adminController.listJobs);
router.post('/jobs', adminController.createJob);
router.put('/jobs/:id', adminController.updateJob);
router.delete('/jobs/:id', adminController.deleteJob);
router.post('/jobs/extract-titles', uploadTitleDoc.single('file'), adminController.extractJobTitles);
router.post('/jobs/confirm-title', adminController.confirmSingleJobTitle);
router.post('/jobs/batch-confirm-titles', adminController.batchConfirmJobTitles);
router.get('/jobs/suggestions', adminController.listJobSuggestions);
router.patch('/jobs/suggestions/:id', adminController.reviewJobSuggestion);

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
