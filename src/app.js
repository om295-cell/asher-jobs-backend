const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const mongoose = require('mongoose');
const routes = require('./routes');
const { errorHandler } = require('./middleware/error.middleware');
const { CLIENT_URL, UPLOAD_DIR } = require('./config/env');

const app = express();

// Security HTTP headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

// CORS configuration supporting credentials and explicit origin
const allowedOrigins = [
  CLIENT_URL,
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      try {
        const host = new URL(origin).hostname;
        if (host.endsWith('.vercel.app') || allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
          return callback(null, true);
        }
      } catch (e) {
        // Fallback for non-standard origin strings
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  })
);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Static files for uploaded CVs
app.use('/uploads', express.static(path.resolve(process.cwd(), UPLOAD_DIR)));

// Favicon handler
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Root health check & API status
app.get('/', (req, res) => {
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

// Main API Routes
app.use('/api', routes);

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
