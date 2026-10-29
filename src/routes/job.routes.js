const express = require('express');
const router = express.Router();
const jobController = require('../controllers/job.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

// Public endpoints for candidate registration and search dropdowns
router.get('/', jobController.getJobs);
router.get('/categories', jobController.getCategories);

// Admin-only catalog synchronization and title deduplication
router.post('/sync-catalog', authenticate, authorize('admin'), jobController.syncCatalog);
router.post('/merge-duplicates', authenticate, authorize('admin'), jobController.mergeDuplicates);

module.exports = router;
