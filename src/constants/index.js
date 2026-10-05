/**
 * server/src/constants/index.js
 *
 * Central place for all shared application constants.
 * Import from here instead of repeating magic strings across services.
 */

// ─── Candidate ────────────────────────────────────────────────────────────────
const AVAILABILITY_STATUSES = Object.freeze([
  'Available',
  'Contacted',
  'Interviewing',
  'Hired',
  'Not Available'
]);

const CANDIDATE_ACCOUNT_STATUSES = Object.freeze(['active', 'deactivated', 'blocked']);

const QUALIFICATIONS = Object.freeze([
  'Technical Diploma',
  'High School',
  'Bachelor',
  'Higher Diploma',
  'Master',
  'PhD'
]);

// ─── Company ──────────────────────────────────────────────────────────────────
const COMPANY_VERIFICATION_STATUSES = Object.freeze([
  'Pending',
  'Approved',
  'Rejected',
  'Suspended',
  'Blocked'
]);

const SUBSCRIPTION_STATUSES  = Object.freeze(['active', 'inactive', 'expired']);
const SUBSCRIPTION_PLANS     = Object.freeze(['Free', 'Basic', 'Custom']);

// ─── User ─────────────────────────────────────────────────────────────────────
const USER_ROLES = Object.freeze(['admin', 'company', 'candidate']);

const USER_ACCOUNT_STATUSES = Object.freeze([
  'active',
  'pending',
  'suspended',
  'deactivated'
]);

// ─── Recommendation ───────────────────────────────────────────────────────────
const RECOMMENDATION_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);

const CAREER_LEVELS = Object.freeze([
  'مبتدئ (1-3 سنوات)',
  'متوسط (3-5 سنوات)',
  'متقدم (5-7 سنوات)',
  'صاحب خبره كبيره (أكثر من 7 سنوات)'
]);

// ─── Referral ─────────────────────────────────────────────────────────────────
const REFERRAL_STATUSES = Object.freeze(['Registered', 'Hired', 'Rewarded']);

// ─── Reports ──────────────────────────────────────────────────────────────────
const REPORT_TYPES = Object.freeze([
  'WRONG_INFO',
  'ALREADY_HIRED',
  'UNREACHABLE',
  'FAKE_PROFILE',
  'OTHER'
]);

const REPORT_STATUSES = Object.freeze(['Open', 'Resolved', 'Dismissed']);

// ─── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULTS = Object.freeze({
  GOVERNORATE:     'Sharqia',
  AREA:            '10th of Ramadan',
  QUALIFICATION:   'Technical Diploma',
  INDUSTRY:        'Industrial & Manufacturing',
  SEARCH_LIMIT:    100,
  EXPORT_LIMIT:    20,
  VIEW_LIMIT:      200,
  PRICE_EGP:       50,
  CV_MAX_SIZE_MB:  5,
  CONSENT_VERSION: '1.0'
});

module.exports = {
  AVAILABILITY_STATUSES,
  CANDIDATE_ACCOUNT_STATUSES,
  QUALIFICATIONS,
  COMPANY_VERIFICATION_STATUSES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_PLANS,
  USER_ROLES,
  USER_ACCOUNT_STATUSES,
  RECOMMENDATION_STATUSES,
  CAREER_LEVELS,
  REFERRAL_STATUSES,
  REPORT_TYPES,
  REPORT_STATUSES,
  DEFAULTS
};
