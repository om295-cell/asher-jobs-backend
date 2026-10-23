const rateLimit = require('express-rate-limit');
const { MongoRateLimitStore } = require('./mongoRateLimitStore');

// OWASP A07 / SEC-51: Strict limiter on login to protect against brute-force and credential stuffing.
// Set to 5 attempts per 15 min per IP — strictly below the 10-attempt account lockout threshold
// so an attacker from a single IP cannot lock out another user's account.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // max 5 attempts per IP per 15 minutes
  store: new MongoRateLimitStore('login'),
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
  store: new MongoRateLimitStore('register'),
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
  store: new MongoRateLimitStore('auth'),
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
  store: new MongoRateLimitStore('search'),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many search requests. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

// Payment initiation makes multiple outbound provider calls. Bound it per
// authenticated company (rather than only per IP) to limit account-driven abuse.
const paymentInitiateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  store: new MongoRateLimitStore('payment-initiate'),
  keyGenerator: (req) => `company:${String(req.company._id)}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many payment attempts. Please try again later.',
    code: 'PAYMENT_RATE_LIMIT_EXCEEDED'
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

// Shared API-wide limiter runs after lazy DB connection. The early in-memory
// apiLimiter remains in place to throttle traffic before connection work.
const apiLimiterShared = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  store: new MongoRateLimitStore('api'),
  skip: (req) => req.originalUrl.split('?')[0] === '/api/health',
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
  paymentInitiateLimiter,
  apiLimiter,
  apiLimiterShared
};
