const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rateLimit.middleware');

router.post('/register/candidate', authLimiter, authController.registerCandidate);
router.post('/register/company', authLimiter, authController.registerCompany);
router.post('/login', authLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.getMe);
router.put('/password', authenticate, authController.updatePassword);

module.exports = router;
