const express = require('express');
const router = express.Router();
const jobController = require('../controllers/job.controller');

// Public endpoints for candidate registration and search dropdowns
router.get('/', jobController.getJobs);
router.get('/categories', jobController.getCategories);

module.exports = router;
