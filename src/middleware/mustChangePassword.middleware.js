const { errorResponse } = require('../utils/response');

/**
 * Middleware that strictly forces accounts with mustChangePassword: true
 * to change their password before accessing any functional features.
 */
function requirePasswordChanged(req, res, next) {
  if (!req.user) {
    return next();
  }

  // Admins do not have forced change unless explicitly flagged
  if (req.user.mustChangePassword) {
    // Allow password change, logout, and getMe endpoints
    const allowedPaths = [
      '/auth/change-initial-password',
      '/auth/update-password',
      '/auth/logout',
      '/auth/me'
    ];

    const isAllowed = allowedPaths.some((p) => req.originalUrl.includes(p));
    if (!isAllowed) {
      return errorResponse(
        res,
        'يجب تغيير كلمة المرور المؤقتة أولاً قبل التمكن من استخدام أي خاصية في النظام.',
        403,
        'PASSWORD_CHANGE_REQUIRED'
      );
    }
  }

  next();
}

module.exports = {
  requirePasswordChanged
};
