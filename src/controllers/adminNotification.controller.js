const adminNotificationService = require('../services/adminNotification.service');
const { successResponse, errorResponse } = require('../utils/response');

/**
 * GET /api/admin/notifications
 * Lists notifications with filtering and pagination
 */
async function list(req, res, next) {
  try {
    const { archived, status, type, page, limit } = req.query;
    const result = await adminNotificationService.listNotifications({
      archived,
      status,
      type,
      page,
      limit
    });
    return res.status(200).json({
      success: true,
      data: result.notifications,
      unreadCount: result.unreadCount,
      activeCount: result.activeCount,
      archivedCount: result.archivedCount,
      pagination: result.pagination
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/admin/notifications/badge-counts
 * Badge counts for topbar and navbar
 */
async function getBadgeCounts(req, res, next) {
  try {
    const counts = await adminNotificationService.getBadgeCounts();
    return successResponse(res, counts);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/notifications/:id/read
 * Mark notification as read
 */
async function markRead(req, res, next) {
  try {
    const { id } = req.params;
    const result = await adminNotificationService.markAsRead(id);
    return successResponse(res, result, 'تم تحديد الإشعار كمقروء');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/notifications/read-all
 * Mark all active notifications as read
 */
async function markAllRead(req, res, next) {
  try {
    const result = await adminNotificationService.markAllAsRead();
    return successResponse(res, result, 'تم تحديد جميع الإشعارات كمقروءة');
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/notifications/:id/archive
 * Move notification to Archive Box
 */
async function archive(req, res, next) {
  try {
    const { id } = req.params;
    const result = await adminNotificationService.archiveNotification(id);
    return successResponse(res, result, 'تم نقل الإشعار إلى صندوق الأرشيف');
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /api/admin/notifications/:id/unarchive
 * Restore notification from Archive Box
 */
async function unarchive(req, res, next) {
  try {
    const { id } = req.params;
    const result = await adminNotificationService.unarchiveNotification(id);
    return successResponse(res, result, 'تمت استعادة الإشعار من الأرشيف بنجاح');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/notifications/:id/resolve
 * Resolve conflict directly from notification
 */
async function resolve(req, res, next) {
  try {
    const { id } = req.params;
    const { action, notes } = req.body;
    const adminUserId = req.user?._id;

    const result = await adminNotificationService.resolveNotification(
      id,
      { action, notes },
      adminUserId
    );

    return successResponse(res, result, 'تمت تسوية الإشعار وتحديث سجلات النظام بنجاح');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  getBadgeCounts,
  markRead,
  markAllRead,
  archive,
  unarchive,
  resolve
};
