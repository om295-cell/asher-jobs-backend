const AdminNotification = require('../models/AdminNotification');
const { RecommendationRequest } = require('../models/RecommendationRequest');
const recommendationService = require('./recommendation.service');

/**
 * Creates a new admin notification
 */
async function createNotification({
  type,
  title,
  message,
  priority = 'medium',
  requestId = null,
  requestNumber = null,
  data = {}
}) {
  try {
    const notification = await AdminNotification.create({
      type,
      title,
      message,
      priority,
      requestId,
      requestNumber,
      data
    });
    return notification;
  } catch (err) {
    console.error('[AdminNotification] Error creating notification:', err.message);
    return null;
  }
}

/**
 * Lists notifications with filters, pagination, and archive support
 */
async function listNotifications({
  archived = false,
  status = '',
  type = '',
  page = 1,
  limit = 20
} = {}) {
  const filter = {
    isArchived: archived === true || archived === 'true'
  };

  if (status && ['unread', 'read'].includes(status)) {
    filter.status = status;
  }

  if (type) {
    filter.type = type;
  }

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * pageSize;

  const [notifications, total, unreadCount, activeCount, archivedCount] = await Promise.all([
    AdminNotification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    AdminNotification.countDocuments(filter),
    AdminNotification.countDocuments({ isArchived: false, status: 'unread' }),
    AdminNotification.countDocuments({ isArchived: false }),
    AdminNotification.countDocuments({ isArchived: true })
  ]);

  return {
    notifications,
    unreadCount,
    activeCount,
    archivedCount,
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1
    }
  };
}

/**
 * Returns badge counts for navbar
 */
async function getBadgeCounts() {
  const [unreadCount, activeCount, archivedCount, phoneConflictsCount, chainsCount] = await Promise.all([
    AdminNotification.countDocuments({ isArchived: false, status: 'unread' }),
    AdminNotification.countDocuments({ isArchived: false }),
    AdminNotification.countDocuments({ isArchived: true }),
    AdminNotification.countDocuments({ isArchived: false, type: 'PHONE_CONFLICT_DIFFERENT_NAMES' }),
    AdminNotification.countDocuments({ isArchived: false, type: 'CHAIN_LINKED_RECOMMENDATION' })
  ]);

  return {
    unreadCount,
    activeCount,
    archivedCount,
    phoneConflictsCount,
    chainsCount
  };
}

/**
 * Mark a notification as read
 */
async function markAsRead(id) {
  const notification = await AdminNotification.findByIdAndUpdate(
    id,
    { status: 'read' },
    { new: true }
  );
  if (!notification) {
    throw { statusCode: 404, message: 'الإشعار غير موجود', code: 'NOT_FOUND' };
  }
  return notification;
}

/**
 * Mark all notifications as read
 */
async function markAllAsRead() {
  await AdminNotification.updateMany(
    { isArchived: false, status: 'unread' },
    { status: 'read' }
  );
  return { success: true };
}

/**
 * Move notification to Archive Box
 */
async function archiveNotification(id) {
  const notification = await AdminNotification.findByIdAndUpdate(
    id,
    {
      isArchived: true,
      archivedAt: new Date()
    },
    { new: true }
  );
  if (!notification) {
    throw { statusCode: 404, message: 'الإشعار غير موجود', code: 'NOT_FOUND' };
  }
  return notification;
}

/**
 * Restore notification from Archive Box
 */
async function unarchiveNotification(id) {
  const notification = await AdminNotification.findByIdAndUpdate(
    id,
    {
      isArchived: false,
      archivedAt: null
    },
    { new: true }
  );
  if (!notification) {
    throw { statusCode: 404, message: 'الإشعار غير موجود', code: 'NOT_FOUND' };
  }
  return notification;
}

/**
 * Executes a conflict resolution directly from the Notification Center
 */
async function resolveNotification(id, { action, notes = '' }, adminUserId) {
  const notification = await AdminNotification.findById(id);
  if (!notification) {
    throw { statusCode: 404, message: 'الإشعار غير موجود', code: 'NOT_FOUND' };
  }

  if (!notification.requestId) {
    throw { statusCode: 400, message: 'لا يوجد طلب مرتبط بهذا الإشعار لتسويته', code: 'NO_REQUEST_LINKED' };
  }

  // Delegate resolution to recommendation service
  const resolutionResult = await recommendationService.resolvePhoneConflict(
    notification.requestId,
    { action, notes },
    adminUserId
  );

  // Update notification state
  notification.status = 'read';
  notification.data = {
    ...notification.data,
    resolution: {
      action,
      resolvedAt: new Date(),
      resolvedBy: adminUserId,
      notes
    }
  };
  await notification.save();

  return {
    success: true,
    notification,
    resolutionResult
  };
}

module.exports = {
  createNotification,
  listNotifications,
  getBadgeCounts,
  markAsRead,
  markAllAsRead,
  archiveNotification,
  unarchiveNotification,
  resolveNotification
};
