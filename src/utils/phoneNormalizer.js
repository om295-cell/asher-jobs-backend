/**
 * Egyptian Phone Number Normalizer
 * Standard Egyptian mobiles are 11 digits starting with 010, 011, 012, or 015.
 * Canonical storage format: +201XXXXXXXXX
 */

function normalizeEgyptianPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { isValid: false, normalized: '', local: '', error: 'Phone number is required' };
  }

  // Remove all non-digit characters except leading plus
  let cleaned = rawPhone.trim().replace(/[\s\-\(\)\.]/g, '');

  // Strip international prefix if present
  if (cleaned.startsWith('+20')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('0020')) {
    cleaned = cleaned.substring(4);
  } else if (cleaned.startsWith('20') && cleaned.length >= 12) {
    cleaned = cleaned.substring(2);
  }

  // Now cleaned should start with 01X or 1X
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // Now cleaned should be 10 digits starting with 10, 11, 12, or 15
  const mobileRegex = /^1[0125][0-9]{8}$/;

  if (!mobileRegex.test(cleaned)) {
    return {
      isValid: false,
      normalized: '',
      local: '',
      error: 'Invalid Egyptian mobile number. Must be 11 digits starting with 010, 011, 012, or 015.'
    };
  }

  const local = '0' + cleaned;
  const normalized = '+20' + cleaned;

  return {
    isValid: true,
    normalized,
    local,
    formatted: `+20 ${cleaned.substring(0, 2)} ${cleaned.substring(2, 6)} ${cleaned.substring(6)}`
  };
}

module.exports = {
  normalizeEgyptianPhone
};
