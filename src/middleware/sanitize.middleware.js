/**
 * OWASP A03: Injection Prevention Middleware
 * Sanitizes req.body, req.query, and req.params against:
 * 1. NoSQL Injection (strips keys starting with '$' or containing '.')
 * 2. Basic XSS (escapes or strips script tags and dangerous HTML in string inputs)
 */

function sanitizeObject(target) {
  if (!target || typeof target !== 'object') {
    return target;
  }

  if (Array.isArray(target)) {
    return target.map((item) => sanitizeObject(item));
  }

  const clean = {};
  for (const [key, value] of Object.entries(target)) {
    // Block NoSQL injection operators (keys starting with '$' or containing '.')
    if (key.startsWith('$') || key.includes('.')) {
      continue;
    }

    // Recursively sanitize objects and arrays
    if (value && typeof value === 'object') {
      clean[key] = sanitizeObject(value);
    } else if (typeof value === 'string') {
      // OWASP A03 / XSS defense: strip script tags, dangerous HTML tags, inline event handlers, and javascript: URIs
      clean[key] = value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    } else {
      clean[key] = value;
    }
  }

  return clean;
}

function sanitizeInput(req, res, next) {
  try {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }
    if (req.query && typeof req.query === 'object') {
      req.query = sanitizeObject(req.query);
    }
    if (req.params && typeof req.params === 'object') {
      req.params = sanitizeObject(req.params);
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Helper to safely escape user input before using in Mongo RegExp
 */
function escapeRegex(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  sanitizeInput,
  escapeRegex
};
