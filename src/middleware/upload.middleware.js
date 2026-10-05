const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { UPLOAD_DIR } = require('../config/env');

// Determine upload directory: on serverless (e.g. Vercel), use /tmp (os.tmpdir())
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const cvDir = isServerless
  ? path.join(os.tmpdir(), 'uploads', 'cvs')
  : path.resolve(process.cwd(), UPLOAD_DIR, 'cvs');

// Safely ensure directory exists without crashing on read-only environments
try {
  if (!fs.existsSync(cvDir)) {
    fs.mkdirSync(cvDir, { recursive: true });
  }
} catch (err) {
  console.warn('[Upload Middleware] Could not create upload directory:', err.message);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, cvDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `cv-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExts = ['.pdf', '.doc', '.docx'];
  const ext = path.extname(file.originalname).toLowerCase();

  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  if (allowedExts.includes(ext) && (allowedMimeTypes.includes(file.mimetype) || file.mimetype === 'application/octet-stream')) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF, DOC, and DOCX documents are allowed.'), false);
  }
};

const uploadCv = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB limit
  },
  fileFilter
});

module.exports = {
  uploadCv,
  cvDir
};
