const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authLimiter, loginLimiter, registerLimiter } = require('../middleware/rateLimit.middleware');

router.post('/register/candidate', registerLimiter, authController.registerCandidate);
router.post('/register/company', registerLimiter, authController.registerCompany);
router.post('/login', loginLimiter, authController.login);
// Logout revokes the current session, so it must pass cookie-auth CSRF checks
// and validate that the presented token is still current.
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.getMe);
router.put('/password', authenticate, authLimiter, authController.updatePassword);
router.post('/change-initial-password', authenticate, authLimiter, authController.changeInitialPassword);

module.exports = router;
