const authService = require('../services/auth.service');
const { successResponse, errorResponse } = require('../utils/response');
const { NODE_ENV } = require('../config/env');

const cookieOptions = {
  httpOnly: true,
  secure: NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

async function registerCandidate(req, res, next) {
  try {
    const result = await authService.registerCandidate(req.body, req);
    res.cookie('token', result.token, cookieOptions);
    return successResponse(res, result, 'Candidate registered successfully', 201);
  } catch (err) {
    next(err);
  }
}

async function registerCompany(req, res, next) {
  try {
    const result = await authService.registerCompany(req.body, req);
    res.cookie('token', result.token, cookieOptions);
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
    return successResponse(res, result, 'Logged in successfully');
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    res.clearCookie('token', cookieOptions);
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

module.exports = {
  registerCandidate,
  registerCompany,
  login,
  logout,
  getMe,
  updatePassword
};
