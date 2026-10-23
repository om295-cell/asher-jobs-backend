const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const User = require('../models/User');
const { errorResponse } = require('../utils/response');

async function authenticate(req, res, next) {
  try {
    let token = null;

    let isCookieAuth = false;
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    // Fallback to cookie
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
      isCookieAuth = true;
    }

    if (!token) {
      return errorResponse(res, 'Authentication required. No token provided.', 401, 'AUTH_REQUIRED');
    }

    // OWASP A01: CSRF Defense for cookie-based authentication on mutating requests
    if (isCookieAuth && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      let origin = req.headers.origin;
      if (!origin && req.headers.referer) {
        try {
          origin = new URL(req.headers.referer).origin;
        } catch {
          origin = null;
        }
      }
      const { CLIENT_URL } = require('../config/env');
      const validOrigins = [
        CLIENT_URL,
        'https://asher-jobs-frontend.vercel.app',
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
      ].filter(Boolean);

      if (process.env.NODE_ENV === 'production') {
        if (!origin || origin === 'null' || !validOrigins.includes(origin)) {
          return errorResponse(res, 'Cross-site request blocked (CSRF protection: valid origin required).', 403, 'CSRF_BLOCKED');
        }
      }
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('+passwordHash');

    if (!user) {
      return errorResponse(res, 'User account no longer exists.', 401, 'USER_NOT_FOUND');
    }

    if (user.isBlocked) {
      return errorResponse(
        res,
        user.blockReason ? `Account has been blocked: ${user.blockReason}` : 'Account has been blocked.',
        403,
        'ACCOUNT_BLOCKED'
      );
    }

    if (user.accountStatus === 'deactivated') {
      return errorResponse(res, 'This account has been deactivated.', 403, 'ACCOUNT_DEACTIVATED');
    }

    if (user.accountStatus === 'suspended') {
      return errorResponse(res, 'This account has been suspended by administration.', 403, 'ACCOUNT_SUSPENDED');
    }

    if (user.accountStatus === 'on_hold') {
      return errorResponse(res, 'This account is currently on hold.', 403, 'ACCOUNT_ON_HOLD');
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return errorResponse(res, 'Session expired. Please log in again.', 401, 'TOKEN_EXPIRED');
    }
    return errorResponse(res, 'Invalid authentication token.', 401, 'INVALID_TOKEN');
  }
}

module.exports = {
  authenticate
};
