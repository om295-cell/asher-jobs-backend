/**
 * Standard API Response Handlers
 */

function successResponse(res, data = null, message = 'Success', statusCode = 200, pagination = null) {
  const payload = {
    success: true,
    message,
    data
  };

  if (pagination) {
    payload.pagination = pagination;
  }

  return res.status(statusCode).json(payload);
}

function errorResponse(res, message = 'An error occurred', statusCode = 500, code = 'ERROR', errors = null) {
  const payload = {
    success: false,
    message,
    code
  };

  if (errors) {
    payload.errors = errors;
  }

  return res.status(statusCode).json(payload);
}

module.exports = {
  successResponse,
  errorResponse
};
