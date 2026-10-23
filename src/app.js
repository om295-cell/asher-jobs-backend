const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const mongoose = require('mongoose');
const routes = require('./routes');
const { errorHandler } = require('./middleware/error.middleware');
const { sanitizeInput } = require('./middleware/sanitize.middleware');
const { apiLimiter, apiLimiterShared } = require('./middleware/rateLimit.middleware');
const { CLIENT_URL, NODE_ENV } = require('./config/env');

const app = express();

// OWASP A05: Disable X-Powered-By header to prevent server fingerprinting
app.disable('x-powered-by');

// ── OWASP A05: Strict CORS Configuration ─────────────────────────────────────
const allowedOrigins = [
  CLIENT_URL,
  'https://asher-jobs-frontend.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Mobile apps, curl, or server-to-server
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // In development only, allow localhost origins
    if (NODE_ENV !== 'production') return callback(null, true);
    return callback(new Error('Blocked by CORS policy (Unauthorized Origin)'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Explicit preflight handler

// OWASP A05: Enhanced Security HTTP headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    xContentTypeOptions: true, // Prevent MIME-type sniffing
    xFrameOptions: { action: 'deny' }, // Anti-clickjacking
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  })
);

// OWASP A04: Body parsers with strictly limited payload size (2MB) to prevent memory exhaustion DoS
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// OWASP A03: Sanitize all inputs against NoSQL injection and XSS
app.use(sanitizeInput);

// Favicon handler
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Root health check & API status. Keep this endpoint cheap: it reports the
// current connection state and must not initiate database work on public traffic.
app.get('/', apiLimiter, async (req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;
  res.status(200).json({
    success: true,
    message: 'Asher Jobs Backend API is running',
    database: isDbConnected ? 'connected' : 'disconnected',
    endpoints: {
      health: '/api/health',
      stats: '/api/stats',
      jobs: '/api/jobs'
    }
  });
});

// SEC-42: Rate limiter is registered BEFORE the lazy-DB middleware.
// This ensures burst requests are throttled before any DB connection work begins,
// preventing connection-slot exhaustion during database outages.
app.use(apiLimiter);

// Lazy DB connection + one-time seed middleware for serverless (Vercel)
// server.js handles seeding in traditional mode, but Vercel uses api/index.js
// which only exports app — so we seed here after the first successful connection.
let _seeded = false;
app.use(async (req, res, next) => {
  if (mongoose.connection.readyState < 1) {
    try {
      const { connectDB } = require('./config/db');
      await connectDB();
    } catch (err) {
      console.warn('[Serverless DB] Connection warning:', err.message);
    }
  }

  // Run seed non-blocking once per cold start
  if (!_seeded && mongoose.connection.readyState === 1) {
    _seeded = true;
    const { autoSeedIfEmpty } = require('./seed');
    autoSeedIfEmpty().catch((err) => {
      console.warn('[Serverless] Seed background warning:', err.message);
    });
  }
  next();
});

// Main API Routes: enforce the shared MongoDB rate limit after lazy DB connection.
app.use('/api', apiLimiterShared, routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    code: 'ROUTE_NOT_FOUND'
  });
});

// Centralized error handler
app.use(errorHandler);

module.exports = app;
