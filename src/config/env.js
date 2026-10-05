require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/asher_jobs_db',
  USE_MEMORY_DB: process.env.USE_MEMORY_DB || 'auto',
  JWT_SECRET: process.env.JWT_SECRET || 'asher_jobs_super_secret_jwt_key_2026_secure',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'asher_jobs_cookie_secret_key_2026',
  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads',
  EGP_MONTHLY_SUBSCRIPTION_PRICE: Number(process.env.EGP_MONTHLY_SUBSCRIPTION_PRICE) || 50
};
