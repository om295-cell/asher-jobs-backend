const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');
const User = require('../models/User');
const { errorResponse } = require('../utils/response');

async function authenticate(req, res, next) {
  try {
    let token = null;

    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    // Fallback to cookie
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return errorResponse(res, 'Authentication required. No token provided.', 401, 'AUTH_REQUIRED');
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
