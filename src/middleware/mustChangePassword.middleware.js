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
    // Allow password change, logout, and getMe endpoints.
    // SEC-32: match against the path ONLY (strip query string) and use startsWith()
    // so ?next=/auth/me or similar query-string injections cannot bypass the gate.
    const allowedPaths = [
      '/auth/change-initial-password',
      '/auth/update-password',
      '/auth/logout',
      '/auth/me'
    ];

    const urlPath = req.originalUrl.split('?')[0].split('#')[0];
    const isAllowed = allowedPaths.some((p) => urlPath.startsWith(p));
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
