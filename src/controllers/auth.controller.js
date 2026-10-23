const jwt = require('jsonwebtoken');
const authService = require('../services/auth.service');
const User = require('../models/User');
const { successResponse, errorResponse } = require('../utils/response');
const { NODE_ENV, JWT_SECRET } = require('../config/env');

const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

const cookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

const clientCookieOptions = {
  httpOnly: false, // readable by client-side JS for instant zero-wait hydration
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

async function registerCandidate(req, res, next) {
  try {
    const result = await authService.registerCandidate(req.body, req);
    res.cookie('token', result.token, cookieOptions);
    res.cookie('asher_logged_in', '1', clientCookieOptions);
    return successResponse(res, result, 'Candidate registered successfully', 201);
  } catch (err) {
    next(err);
  }
}

async function registerCompany(req, res, next) {
  try {
    const result = await authService.registerCompany(req.body, req);
    res.cookie('token', result.token, cookieOptions);
    res.cookie('asher_logged_in', '1', clientCookieOptions);
    return successResponse(
      res,
      result,
      'Company registered successfully. Account is pending administrator review.',
      201
    );
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { credential, password } = req.body;
    const result = await authService.login(credential, password, req);
    res.cookie('token', result.token, cookieOptions);
    res.cookie('asher_logged_in', '1', clientCookieOptions);
    return successResponse(res, result, 'Logged in successfully');
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    // SEC-23 & SEC-24: Invalidate active token by bumping tokenVersion conditionally
    let token = null;
    const authHeader = req.headers && req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    let userId = null;
    let presentedTv = null;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.id;
        presentedTv = decoded.tv ?? 0;
      } catch (_) {}
    } else if (req.user && req.user._id) {
      userId = req.user._id;
      presentedTv = req.user.tokenVersion ?? 0;
    }

    // SEC-24: Only bump tokenVersion if the presented token matches the database version.
    // Stale/revoked tokens cannot be replayed to DoS other valid sessions.
    if (userId && typeof presentedTv === 'number') {
      if (presentedTv === 0) {
        await User.updateOne(
          { _id: userId, $or: [{ tokenVersion: 0 }, { tokenVersion: { $exists: false } }] },
          { $inc: { tokenVersion: 1 } }
        );
      } else {
        await User.updateOne(
          { _id: userId, tokenVersion: presentedTv },
          { $inc: { tokenVersion: 1 } }
        );
      }
    }

    res.clearCookie('token', cookieOptions);
    res.clearCookie('asher_logged_in', clientCookieOptions);
    return successResponse(res, null, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
}

async function getMe(req, res, next) {
  try {
    const result = await authService.getMe(req.user._id);
    return successResponse(res, result, 'Current user retrieved');
  } catch (err) {
    next(err);
  }
}

async function updatePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    await authService.updatePassword(req.user._id, currentPassword, newPassword);
    return successResponse(res, null, 'Password updated successfully');
  } catch (err) {
    next(err);
  }
}

async function changeInitialPassword(req, res, next) {
  try {
    const employerAccountService = require('../services/employerAccount.service');
    const { newPassword } = req.body;
    const result = await employerAccountService.changeInitialPassword(
      req.user._id,
      newPassword,
      req
    );
    return successResponse(res, result, 'تم تغيير كلمة المرور بنجاح.');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  registerCandidate,
  registerCompany,
  login,
  logout,
  getMe,
  updatePassword,
  changeInitialPassword
};
