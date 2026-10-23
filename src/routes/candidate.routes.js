const express = require('express');
const router = express.Router();
const candidateController = require('../controllers/candidate.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');
const { requireApprovedCompany } = require('../middleware/companyApproval.middleware');
const { requireActiveSubscription } = require('../middleware/subscription.middleware');
const { requirePasswordChanged } = require('../middleware/mustChangePassword.middleware');
const { uploadCv } = require('../middleware/upload.middleware');
const { searchLimiter } = require('../middleware/rateLimit.middleware');

// Candidate Self-Management Routes (SEC-47: require password change before self-management)
router.get('/me', authenticate, requirePasswordChanged, authorize('candidate'), candidateController.getMyProfile);
router.put('/me', authenticate, requirePasswordChanged, authorize('candidate'), candidateController.updateMyProfile);
router.patch('/me/availability', authenticate, requirePasswordChanged, authorize('candidate'), candidateController.updateAvailability);
router.post('/me/cv', authenticate, requirePasswordChanged, authorize('candidate'), uploadCv.single('cv'), candidateController.uploadCv);
router.delete('/me/cv', authenticate, requirePasswordChanged, authorize('candidate'), candidateController.deleteCv);
router.delete('/me', authenticate, requirePasswordChanged, authorize('candidate'), candidateController.deactivateProfile);
router.get('/me/referrals', authenticate, requirePasswordChanged, authorize('candidate'), candidateController.getMyReferrals);

// CV Document Download (Candidate self or Approved Company or Admin - requires password change)
router.get('/cv/:id', authenticate, requirePasswordChanged, candidateController.downloadCv);

// Platinum Dedicated Candidate Database Browsing Routes (Strictly Platinum, 1 at a time view/download)
router.get(
  '/platinum/browse',
  authenticate,
  requirePasswordChanged,
  requireApprovedCompany,
  requireActiveSubscription(),   // SEC-29: block expired subscriptions
  searchLimiter,
  candidateController.browseCandidatesPlatinum
);

router.get(
  '/platinum/candidate/:id',
  authenticate,
  requirePasswordChanged,
  requireApprovedCompany,
  requireActiveSubscription({ checkSearchLimit: true }),
  searchLimiter,
  candidateController.getPlatinumCandidateDetail
);

router.get(
  '/platinum/candidate/:id/download',
  authenticate,
  requirePasswordChanged,
  requireApprovedCompany,
  requireActiveSubscription({ checkExportLimit: true }),   // SEC-50: enforce monthly export limit on platinum download
  candidateController.downloadPlatinumCandidateExcel
);

// Employer Search & Export Routes (Strictly requires Approved Company + Active Subscription)
router.get(
  '/search',
  authenticate,
  requirePasswordChanged,
  requireApprovedCompany,
  requireActiveSubscription({ checkSearchLimit: true }),
  searchLimiter,
  candidateController.searchCandidates
);

router.get(
  '/export',
  authenticate,
  requirePasswordChanged,
  requireApprovedCompany,
  requireActiveSubscription({ checkExportLimit: true }),
  candidateController.exportCandidates
);

router.get(
  '/:id',
  authenticate,
  requirePasswordChanged,
  requireApprovedCompany,
  requireActiveSubscription({ checkSearchLimit: true }),
  searchLimiter,
  candidateController.getCandidateById
);

router.post(
  '/:id/interact',
  authenticate,
  requirePasswordChanged,
  requireApprovedCompany,
  requireActiveSubscription(),
  candidateController.recordCandidateInteraction
);

module.exports = router;
