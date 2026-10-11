const express = require('express');
const router = express.Router();
const adminNotificationController = require('../controllers/adminNotification.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { authorize } = require('../middleware/role.middleware');

// All routes require super admin authentication
router.use(authenticate, authorize('admin'));

router.get('/', adminNotificationController.list);
router.get('/badge-counts', adminNotificationController.getBadgeCounts);
router.post('/read-all', adminNotificationController.markAllRead);
router.patch('/:id/read', adminNotificationController.markRead);
router.patch('/:id/archive', adminNotificationController.archive);
router.patch('/:id/unarchive', adminNotificationController.unarchive);
router.post('/:id/resolve', adminNotificationController.resolve);

module.exports = router;
