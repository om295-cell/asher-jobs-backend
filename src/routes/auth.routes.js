const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authLimiter, loginLimiter, registerLimiter } = require('../middleware/rateLimit.middleware');

router.post('/register/candidate', registerLimiter, authController.registerCandidate);
router.post('/register/company', registerLimiter, authController.registerCompany);
router.post('/login', loginLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.getMe);
router.put('/password', authenticate, authLimiter, authController.updatePassword);
router.post('/change-initial-password', authenticate, authLimiter, authController.changeInitialPassword);

module.exports = router;
