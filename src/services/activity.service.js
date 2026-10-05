const ActivityLog = require('../models/ActivityLog');
const { getPagination, formatPagination } = require('../utils/pagination');

async function logActivity({ actorId, actorRole, action, entityType, entityId, metadata = {}, req = null }) {
  try {
    let ipAddress = '';
    let userAgent = '';

    if (req) {
      ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      userAgent = req.headers['user-agent'] || '';
    }

    const log = await ActivityLog.create({
      actorId: actorId || null,
      actorRole: actorRole || 'system',
      action,
      entityType,
      entityId: entityId || null,
      metadata,
      ipAddress,
      userAgent
    });

    return log;
  } catch (err) {
    console.error('[ActivityLog Error]', err.message);
    // Non-blocking; do not fail calling request
    return null;
  }
}

async function getActivityLogs(query = {}) {
  const { page, limit, skip } = getPagination(query);
  const filter = {};
  if (query.action) filter.action = query.action;
  if (query.entityType) filter.entityType = query.entityType;

  const [items, total] = await Promise.all([
    ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('actorId', 'email role phone')
      .lean(),
    ActivityLog.countDocuments(filter)
  ]);

  return {
    items,
    pagination: formatPagination(total, page, limit)
  };
}

module.exports = {
  logActivity,
  getActivityLogs
};
