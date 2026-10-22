const rateLimit = require('express-rate-limit');

// OWASP A07: Strict limiter on login to protect against brute-force and credential stuffing
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 failed/successful attempts per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
    code: 'LOGIN_RATE_LIMIT_EXCEEDED'
  }
});

// OWASP A04: Limiter on registration to prevent automated bot account creation
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 registration attempts per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many registration requests. Please wait before registering again.',
    code: 'REGISTER_RATE_LIMIT_EXCEEDED'
  }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication requests. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many search requests. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

// OWASP A04: Global API rate limiter to protect server from Denial of Service (DoS)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // 2000 requests per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests to the server. Please slow down.',
    code: 'GLOBAL_RATE_LIMIT_EXCEEDED'
  }
});

module.exports = {
  loginLimiter,
  registerLimiter,
  authLimiter,
  searchLimiter,
  apiLimiter
};
