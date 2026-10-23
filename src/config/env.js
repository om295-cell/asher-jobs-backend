require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

const FALLBACK_JWT_SECRET = 'asher_jobs_super_secret_jwt_key_2026_secure';

if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET === FALLBACK_JWT_SECRET)) {
  throw new Error('FATAL SECURITY CONFIGURATION: JWT_SECRET must be set to a strong, unique secret in production environment variables. Default fallback is strictly prohibited.');
}

module.exports = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || (process.env.VERCEL ? 'production' : 'development'),
  CLIENT_URL: process.env.CLIENT_URL || 'https://asher-jobs-frontend.vercel.app',
  MONGO_URI: process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/asher_jobs_db',
  USE_MEMORY_DB: process.env.USE_MEMORY_DB || 'auto',
  JWT_SECRET: process.env.JWT_SECRET || 'asher_jobs_super_secret_jwt_key_2026_secure',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'asher_jobs_cookie_secret_key_2026',
  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads',
  EGP_MONTHLY_SUBSCRIPTION_PRICE: Number(process.env.EGP_MONTHLY_SUBSCRIPTION_PRICE) || 50
};
