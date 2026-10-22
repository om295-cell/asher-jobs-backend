const express = require('express');
const router = express.Router();
const jobController = require('../controllers/job.controller');

// Public endpoints for candidate registration and search dropdowns
router.get('/', jobController.getJobs);
router.get('/categories', jobController.getCategories);
router.get('/sync-catalog', jobController.syncCatalog);
router.post('/sync-catalog', jobController.syncCatalog);

module.exports = router;
