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

// Candidate Self-Management Routes
router.get('/me', authenticate, authorize('candidate'), candidateController.getMyProfile);
router.put('/me', authenticate, authorize('candidate'), candidateController.updateMyProfile);
router.patch('/me/availability', authenticate, authorize('candidate'), candidateController.updateAvailability);
router.post('/me/cv', authenticate, authorize('candidate'), uploadCv.single('cv'), candidateController.uploadCv);
router.delete('/me/cv', authenticate, authorize('candidate'), candidateController.deleteCv);
router.delete('/me', authenticate, authorize('candidate'), candidateController.deactivateProfile);
router.get('/me/referrals', authenticate, authorize('candidate'), candidateController.getMyReferrals);

// CV Document Download (Candidate self or Approved Company or Admin)
router.get('/cv/:id', authenticate, candidateController.downloadCv);

// Platinum Dedicated Candidate Database Browsing Routes (Strictly Platinum, 1 at a time view/download)
router.get(
  '/platinum/browse',
  authenticate,
  requirePasswordChanged,
  requireApprovedCompany,
  candidateController.browseCandidatesPlatinum
);

router.get(
  '/platinum/candidate/:id',
  authenticate,
  requirePasswordChanged,
  requireApprovedCompany,
  candidateController.getPlatinumCandidateDetail
);

router.get(
  '/platinum/candidate/:id/download',
  authenticate,
  requirePasswordChanged,
  requireApprovedCompany,
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
  requireActiveSubscription(),
  candidateController.getCandidateById
);

router.post(
  '/:id/interact',
  authenticate,
  requirePasswordChanged,
  requireApprovedCompany,
  candidateController.recordCandidateInteraction
);

module.exports = router;
