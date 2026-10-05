const { errorResponse } = require('../utils/response');

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 'Authentication required.', 401, 'AUTH_REQUIRED');
    }

    const flatRoles = roles.flat();
    if (!flatRoles.includes(req.user.role)) {
      return errorResponse(
        res,
        `Access denied. Requires one of roles: [${flatRoles.join(', ')}]`,
        403,
        'FORBIDDEN'
      );
    }

    next();
  };
}

module.exports = {
  authorize
};
