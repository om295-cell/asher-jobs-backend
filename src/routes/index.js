const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const candidateRoutes = require('./candidate.routes');
const companyRoutes = require('./company.routes');
const jobRoutes = require('./job.routes');
const recruitmentRequestRoutes = require('./recruitmentRequest.routes');
const reportRoutes = require('./report.routes');
const adminRoutes = require('./admin.routes');
const recommendationRoutes = require('./recommendation.routes');
const { getStats, recordVisit } = require('../controllers/stats.controller');

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Asher Jobs API'
  });
});

// Public stats and visit tracking
router.get('/stats', getStats);
router.post('/stats/visit', recordVisit);

router.use('/auth', authRoutes);
router.use('/candidates', candidateRoutes);
router.use('/companies', companyRoutes);
router.use('/jobs', jobRoutes);
router.use('/recruitment-requests', recruitmentRequestRoutes);
router.use('/reports', reportRoutes);
router.use('/recommendations', recommendationRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
