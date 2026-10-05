const { errorResponse } = require('../utils/response');

function errorHandler(err, req, res, next) {
  console.error('[Error Handler]', err);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((val) => val.message);
    return errorResponse(res, messages.join(', '), 400, 'VALIDATION_ERROR', err.errors);
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return errorResponse(res, `Duplicate entry for ${field}. Please use another value.`, 409, 'DUPLICATE_KEY_ERROR');
  }

  // CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    return errorResponse(res, `Resource not found with id: ${err.value}`, 404, 'RESOURCE_NOT_FOUND');
  }

  // Multer errors
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return errorResponse(res, 'File size exceeds the 5MB limit.', 400, 'FILE_TOO_LARGE');
    }
    return errorResponse(res, err.message, 400, 'UPLOAD_ERROR');
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  return errorResponse(res, message, statusCode, err.code || 'SERVER_ERROR');
}

module.exports = {
  errorHandler
};
