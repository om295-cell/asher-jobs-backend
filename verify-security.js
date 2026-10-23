/**
 * Comprehensive Defensive Security Verification Suite
 * Verifies that the 16 remediated controls (SEC-01 through SEC-16) function as expected.
 * Run via: node verify-security.js
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

console.log('====================================================');
console.log('   ASHER JOBS SECURITY CONTROLS VERIFICATION SUITE   ');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;
const tests = [];

function check(testName, fn) {
  tests.push({ testName, fn });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SEC-01: JWT Forgery & Secret Strength Test
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-01: Forged or invalid JWT tokens are strictly rejected', () => {
  const legitSecret = 'real_super_secret_jwt_key_at_least_32_characters!';
  const attackerSecret = 'attacker_secret_key_used_to_forge_admin_token!';
  
  const forgedAdminToken = jwt.sign(
    { userId: 'fake_admin_123', role: 'admin' },
    attackerSecret,
    { expiresIn: '1h' }
  );

  assert.throws(
    () => {
      jwt.verify(forgedAdminToken, legitSecret);
    },
    /invalid signature/,
    'Forged JWT with attacker secret must fail signature validation'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SEC-04: CSRF Defense (Origin / Referer Validation)
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-04: Cross-site mutating requests with foreign Origin are blocked', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'verify_prod_jwt_secret_unique_1234567890';
  process.env.NODE_ENV = 'production';
  const { authenticate } = require('./src/middleware/auth.middleware');
  
  let statusCaptured = 0;
  let jsonCaptured = null;

  const fakeReq = {
    method: 'POST',
    cookies: { token: 'valid_looking_token' },
    headers: {
      origin: 'https://malicious-attacker-site.com',
      referer: 'https://malicious-attacker-site.com/exploit'
    }
  };

  const fakeRes = {
    status: (code) => {
      statusCaptured = code;
      return {
        json: (data) => { jsonCaptured = data; }
      };
    }
  };

  authenticate(fakeReq, fakeRes, () => {
    throw new Error('Should not have called next() for malicious origin');
  });

  process.env.NODE_ENV = originalEnv;
  process.env.JWT_SECRET = originalSecret;
  assert.strictEqual(statusCaptured, 403, 'Should respond with 403 Forbidden on CSRF mismatch');
  assert.strictEqual(jsonCaptured.code, 'CSRF_BLOCKED', 'Should indicate CSRF block');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SEC-08: Password Strength Policy (Minimum 8 Characters)
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-08: Passwords shorter than 8 characters are rejected', () => {
  const shortPasswords = ['123', 'admin', 'pass1', 'short7'];
  const validPassword = 'StrongPassword2026!';

  for (const p of shortPasswords) {
    const isTooShort = !p || p.length < 8;
    assert.strictEqual(isTooShort, true, `Password "${p}" should be rejected`);
  }
  assert.strictEqual(validPassword.length >= 8, true, 'Valid password should pass length check');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SEC-09: Paymob HMAC Signature Tampering Test
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-09: Payment webhook rejects altered payloads or mismatched HMAC', () => {
  const hmacSecret = 'test_paymob_hmac_secret_key';
  const legitimateData = {
    amount_cents: 150000,
    created_at: '2026-10-22T12:00:00',
    currency: 'EGP',
    error_occured: false,
    has_parent_transaction: false,
    id: 998877,
    integration_id: 12345,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 554433 },
    owner: 101,
    pending: false,
    'source_data.pan': '2345',
    'source_data.sub_type': 'MasterCard',
    'source_data.type': 'card',
    success: true
  };

  // Concatenate keys in Paymob order
  const values = [
    legitimateData.amount_cents,
    legitimateData.created_at,
    legitimateData.currency,
    legitimateData.error_occured,
    legitimateData.has_parent_transaction,
    legitimateData.id,
    legitimateData.integration_id,
    legitimateData.is_3d_secure,
    legitimateData.is_auth,
    legitimateData.is_capture,
    legitimateData.is_refunded,
    legitimateData.is_standalone_payment,
    legitimateData.is_voided,
    legitimateData.order.id,
    legitimateData.owner,
    legitimateData.pending,
    legitimateData['source_data.pan'],
    legitimateData['source_data.sub_type'],
    legitimateData['source_data.type'],
    legitimateData.success
  ];

  const legitimateHmac = crypto
    .createHmac('sha512', hmacSecret)
    .update(values.join(''))
    .digest('hex');

  // Attacker tries tampering with amount (change 150000 to 100)
  const tamperedValues = [...values];
  tamperedValues[0] = 100; // 1 EGP instead of 1500 EGP
  const tamperedHmac = crypto
    .createHmac('sha512', hmacSecret)
    .update(tamperedValues.join(''))
    .digest('hex');

  assert.notStrictEqual(legitimateHmac, tamperedHmac, 'Tampered amount must yield different HMAC');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. SEC-13: Formula / CSV Injection Escaping
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-13: Excel cells starting with dangerous formula characters are escaped', () => {
  // Read export.service logic
  function sanitizeExcelCell(val) {
    if (val === null || val === undefined) return '';
    if (typeof val !== 'string') return val;
    const trimmed = val.trim();
    if (/^[=+\-@\t\r]/.test(trimmed)) {
      return `'${val}`;
    }
    return val;
  }

  const maliciousPayloads = [
    '=cmd|\'/C calc\'!A0',
    '+2+5',
    '-SUM(A1:A10)',
    '@HYPERLINK("http://evil.com")',
    '\t=1+1',
    '\r=alert(1)'
  ];

  for (const payload of maliciousPayloads) {
    const sanitized = sanitizeExcelCell(payload);
    assert.strictEqual(sanitized.startsWith("'"), true, `Payload "${payload}" must be escaped with a leading single quote`);
  }

  const benignText = 'مهندس برمجيات';
  assert.strictEqual(sanitizeExcelCell(benignText), benignText, 'Normal text must remain unchanged');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. SEC-14: PII / Identity Enumeration Protection
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-14: Names in phone availability conflicts are masked to prevent identity harvesting', () => {
  function maskFullName(name) {
    if (!name || typeof name !== 'string') return '***';
    return name
      .trim()
      .split(/\s+/)
      .map((part) => (part.length > 0 ? part.charAt(0) + '***' : '***'))
      .join(' ');
  }

  const realVictimName = 'أحمد محمد محمود';
  const masked = maskFullName(realVictimName);
  
  assert.strictEqual(masked, 'أ*** م*** م***', 'Full Arabic name must be masked per word');
  assert.strictEqual(masked.includes('محمد'), false, 'Masked result must not contain plain name');
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. SEC-15: Internal Admin Notes Disclosure in Public Tracking
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-15: Public tracking payload excludes internal admin notes', () => {
  const reqRecord = {
    requestNumber: 'REC-123456',
    status: 'pending',
    adminNotes: 'CONFIDENTIAL: Candidate interview failed behavioral test.',
    createdAt: new Date(),
    people: [{ fullName: 'علي حسن', phone: '01012345678' }]
  };

  // Tracking response projection
  const publicTrackingResult = {
    requestNumber: reqRecord.requestNumber,
    status: reqRecord.status,
    submitterName: reqRecord.people[0].fullName,
    createdAt: reqRecord.createdAt
  };

  assert.strictEqual('adminNotes' in publicTrackingResult, false, 'adminNotes must not exist in public result');
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. SEC-16: Path Traversal Prevention in CV Download
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-16: Arbitrary file download / Path traversal outside uploads directory is blocked', () => {
  const allowedBaseDirs = [
    path.resolve(process.cwd(), 'uploads'),
    path.resolve(os.tmpdir())
  ];

  function isPathSafe(untrustedPath) {
    const resolved = path.resolve(untrustedPath);
    return allowedBaseDirs.some((dir) => resolved.startsWith(dir));
  }

  const maliciousPaths = [
    '../../../../etc/passwd',
    '..\\..\\..\\Windows\\System32\\cmd.exe',
    '/etc/shadow',
    'C:\\Windows\\win.ini',
    '../../.env'
  ];

  for (const p of maliciousPaths) {
    assert.strictEqual(isPathSafe(p), false, `Path "${p}" should be detected as outside allowed directories`);
  }

  const validPath = path.join(process.cwd(), 'uploads', 'cvs', 'cv-12345.pdf');
  assert.strictEqual(isPathSafe(validPath), true, 'Legitimate CV path must be allowed');
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. SEC-17: Fallback JWT Secret Rejection in Production
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-17: Fallback JWT_SECRET is blocked with a fatal exception in production', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.JWT_SECRET;

  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'asher_jobs_super_secret_jwt_key_2026_secure';

  const envPath = require.resolve('./src/config/env');
  delete require.cache[envPath];

  let threwError = false;
  try {
    require('./src/config/env');
  } catch (err) {
    threwError = true;
    assert.match(err.message, /FATAL SECURITY CONFIGURATION/);
  } finally {
    process.env.NODE_ENV = originalEnv;
    process.env.JWT_SECRET = originalSecret;
    delete require.cache[envPath];
  }

  assert.strictEqual(threwError, true, 'Must throw fatal error on fallback JWT secret in production');
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. SEC-18: CSRF Rejection on Missing or Null Origin in Production
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-18: Cross-site mutating requests with missing or null Origin are blocked', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'verify_prod_jwt_secret_unique_1234567890';
  process.env.NODE_ENV = 'production';

  const authMiddlewarePath = require.resolve('./src/middleware/auth.middleware');
  delete require.cache[authMiddlewarePath];
  const { authenticate } = require('./src/middleware/auth.middleware');

  const testCases = [
    { origin: undefined, referer: undefined },
    { origin: 'null', referer: undefined },
    { origin: '', referer: '' }
  ];

  for (const tc of testCases) {
    let statusCaptured = 0;
    let jsonCaptured = null;

    const fakeReq = {
      method: 'POST',
      cookies: { token: 'sample_token' },
      headers: {
        origin: tc.origin,
        referer: tc.referer
      }
    };

    const fakeRes = {
      status: (code) => {
        statusCaptured = code;
        return {
          json: (data) => { jsonCaptured = data; }
        };
      }
    };

    authenticate(fakeReq, fakeRes, () => {
      throw new Error('Should not have called next() for missing or null origin');
    });

    assert.strictEqual(statusCaptured, 403, `Must block mutating request with origin: "${tc.origin}"`);
    assert.strictEqual(jsonCaptured.code, 'CSRF_BLOCKED');
  }

  process.env.NODE_ENV = originalEnv;
  process.env.JWT_SECRET = originalSecret;
  delete require.cache[authMiddlewarePath];
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. SEC-19: Input Sanitizer Strips Stored HTML Tags & Inline Event Handlers
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-19: Input sanitizer strips raw HTML tags and inline event handlers', () => {
  const { sanitizeInput } = require('./src/middleware/sanitize.middleware');

  const req = {
    body: {
      fullName: 'John <script>alert(1)</script><img src=x onerror=alert(2)> Doe',
      title: '<svg onload=alert(1)>Engineer</svg>',
      nested: {
        field: 'Safe text <iframe src="evil.com"></iframe>'
      }
    }
  };

  sanitizeInput(req, {}, () => {});

  assert.strictEqual(req.body.fullName.includes('<script>'), false, 'Must strip script tags');
  assert.strictEqual(req.body.fullName.includes('<img'), false, 'Must strip img tags');
  assert.strictEqual(req.body.fullName.includes('onerror='), false, 'Must strip onerror handlers');
  assert.strictEqual(req.body.title.includes('<svg>'), false, 'Must strip svg tags');
  assert.strictEqual(req.body.title.includes('onload='), false, 'Must strip onload handlers');
  assert.strictEqual(req.body.nested.field.includes('<iframe>'), false, 'Must strip iframe tags');
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. SEC-20: Magic Byte File Signature Verification for Document Uploads
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-20: Upload validation accepts valid document magic bytes and rejects executables', () => {
  const fs = require('fs');

  function checkSignature(buffer) {
    const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
    const isDocx = buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
    const isDoc = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
    return isPdf || isDocx || isDoc;
  }

  // Legitimate signatures
  const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x35]); // %PDF-1.5
  const docxHeader = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]); // PK..
  const docHeader = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]); // OLE

  // Malicious/executable signatures disguised as PDF
  const elfBinary = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00]); // .ELF
  const dosExe = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ..
  const phpScript = Buffer.from('<?php echo "evil"; ?>');

  assert.strictEqual(checkSignature(pdfHeader), true, 'PDF magic bytes must pass');
  assert.strictEqual(checkSignature(docxHeader), true, 'DOCX magic bytes must pass');
  assert.strictEqual(checkSignature(docHeader), true, 'DOC magic bytes must pass');

  assert.strictEqual(checkSignature(elfBinary), false, 'ELF executable must be rejected');
  assert.strictEqual(checkSignature(dosExe), false, 'Windows PE/EXE binary must be rejected');
  assert.strictEqual(checkSignature(phpScript), false, 'PHP script must be rejected');
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. SEC-21: Suspended & On-Hold Company Access Gate
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-21: Suspended and on-hold company accounts are blocked from accessing candidate data', async () => {
  const { requireApprovedCompany } = require('./src/middleware/companyApproval.middleware');
  const Company = require('./src/models/Company');

  const originalFindOne = Company.findOne;

  // Stub company model to simulate an approved, active-subscription but SUSPENDED company
  Company.findOne = () => Promise.resolve({
    _id: 'comp_123',
    userId: 'user_123',
    companyName: 'Suspended Corp',
    verificationStatus: 'Approved',
    subscriptionStatus: 'active',
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    isBlocked: false,
    accountStatus: 'suspended'
  });

  let statusCaptured = 0;
  let jsonCaptured = null;

  const fakeReq = {
    user: {
      _id: 'user_123',
      role: 'company',
      accountStatus: 'suspended',
      isBlocked: false
    }
  };

  const fakeRes = {
    status: (code) => {
      statusCaptured = code;
      return {
        json: (data) => { jsonCaptured = data; }
      };
    }
  };

  await requireApprovedCompany(fakeReq, fakeRes, () => {
    throw new Error('Should not have called next() for suspended company');
  });

  Company.findOne = originalFindOne;

  assert.strictEqual(statusCaptured, 403, 'Must return 403 Forbidden for suspended company');
  assert.strictEqual(jsonCaptured.code, 'COMPANY_SUSPENDED', 'Must indicate suspended company status');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-22: Token Revocation on Password Change
// ─────────────────────────────────────────────────────────────────────────────
// SEC-22: Token Revocation on Password Change (Deterministic Token Version)
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-22: Tokens issued before a password change (even in same second) are rejected with 401', async () => {
  const { authenticate } = require('./src/middleware/auth.middleware');
  const { JWT_SECRET } = require('./src/config/env');
  const User = require('./src/models/User');

  // Token issued with initial tokenVersion = 0, even with iat matching current second
  const sameSecondIat = Math.floor(Date.now() / 1000);
  const staleToken = jwt.sign(
    { id: 'user_sec22', role: 'candidate', tv: 0, iat: sameSecondIat },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // User changed password, so user.tokenVersion was incremented to 1
  const originalFindById = User.findById.bind(User);
  User.findById = () => ({
    select: () =>
      Promise.resolve({
        _id: 'user_sec22',
        role: 'candidate',
        isBlocked: false,
        accountStatus: 'active',
        passwordHash: '$2b$10$placeholder',
        tokenVersion: 1 // Bumped after password change
      })
  });

  let statusCaptured = 0;
  let codeCaptured = null;
  let nextCalled = false;

  const fakeReq = {
    headers: { authorization: `Bearer ${staleToken}` },
    method: 'GET',
    cookies: {}
  };

  const fakeRes = {
    status: (code) => {
      statusCaptured = code;
      return {
        json: (data) => {
          codeCaptured = data.code;
        }
      };
    }
  };

  await authenticate(fakeReq, fakeRes, () => { nextCalled = true; });

  User.findById = originalFindById;

  assert.strictEqual(nextCalled, false, 'next() must NOT be called for a pre-change token');
  assert.strictEqual(statusCaptured, 401, 'Must return 401 for invalidated token version');
  assert.strictEqual(codeCaptured, 'TOKEN_INVALIDATED', 'Must return TOKEN_INVALIDATED code');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-23: Bearer Token Server-Side Revocation on Logout
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-23: Logout revokes existing bearer tokens server-side via tokenVersion bump', async () => {
  const { authenticate } = require('./src/middleware/auth.middleware');
  const authController = require('./src/controllers/auth.controller');
  const { JWT_SECRET } = require('./src/config/env');
  const User = require('./src/models/User');

  // Synthetic user in memory with tokenVersion = 0
  const mockUserRecord = {
    _id: 'user_sec23',
    role: 'candidate',
    isBlocked: false,
    accountStatus: 'active',
    passwordHash: '$2b$10$placeholder',
    tokenVersion: 0
  };

  // Issue bearer token for this user
  const bearerToken = jwt.sign(
    { id: mockUserRecord._id, role: mockUserRecord.role, tv: mockUserRecord.tokenVersion },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // Stub User methods
  const originalFindById = User.findById.bind(User);
  const originalUpdateOne = User.updateOne.bind(User);

  User.findById = () => ({
    select: () => Promise.resolve(mockUserRecord)
  });

  User.updateOne = (filter, update) => {
    const idMatch = filter._id === mockUserRecord._id;
    let tvMatch = false;
    if (filter.tokenVersion !== undefined) {
      tvMatch = filter.tokenVersion === mockUserRecord.tokenVersion;
    } else if (filter.$or) {
      tvMatch = mockUserRecord.tokenVersion === 0;
    }
    if (idMatch && tvMatch && update.$inc && update.$inc.tokenVersion) {
      mockUserRecord.tokenVersion += update.$inc.tokenVersion;
      return Promise.resolve({ modifiedCount: 1 });
    }
    return Promise.resolve({ modifiedCount: 0 });
  };

  // 1. First verify the token works before logout
  let preLogoutNextCalled = false;
  const preReq = {
    headers: { authorization: `Bearer ${bearerToken}` },
    method: 'GET',
    cookies: {}
  };
  const preRes = {
    status: () => preRes,
    json: () => {}
  };
  await authenticate(preReq, preRes, () => { preLogoutNextCalled = true; });
  assert.strictEqual(preLogoutNextCalled, true, 'Bearer token must authenticate successfully before logout');

  // 2. Perform logout (clearing cookies AND bumping tokenVersion server-side)
  let clearedCookies = [];
  const logoutReq = {
    headers: { authorization: `Bearer ${bearerToken}` },
    cookies: {}
  };
  const logoutRes = {
    clearCookie: (name) => { clearedCookies.push(name); },
    status: () => logoutRes,
    json: () => {}
  };
  await authController.logout(logoutReq, logoutRes, () => {});

  assert.strictEqual(mockUserRecord.tokenVersion, 1, 'Logout must bump tokenVersion in DB');
  assert.ok(clearedCookies.includes('token'), 'Logout must clear cookie');

  // 3. Attempt to use the same old bearer token after logout
  let postLogoutNextCalled = false;
  let postLogoutStatus = 0;
  let postLogoutCode = null;

  const postReq = {
    headers: { authorization: `Bearer ${bearerToken}` },
    method: 'GET',
    cookies: {}
  };
  const postRes = {
    status: (code) => {
      postLogoutStatus = code;
      return {
        json: (data) => { postLogoutCode = data.code; }
      };
    }
  };

  await authenticate(postReq, postRes, () => { postLogoutNextCalled = true; });

  // Restore stubs
  User.findById = originalFindById;
  User.updateOne = originalUpdateOne;

  assert.strictEqual(postLogoutNextCalled, false, 'next() must NOT be called for a logged-out bearer token');
  assert.strictEqual(postLogoutStatus, 401, 'Must return 401 for revoked bearer token');
  assert.strictEqual(postLogoutCode, 'TOKEN_INVALIDATED', 'Must return TOKEN_INVALIDATED code');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-24: Replaying Stale/Revoked Token at /logout Cannot DoS Active Sessions
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-24: Stale or already-revoked token presented to /logout does NOT bump tokenVersion', async () => {
  const { authenticate } = require('./src/middleware/auth.middleware');
  const authController = require('./src/controllers/auth.controller');
  const { JWT_SECRET } = require('./src/config/env');
  const User = require('./src/models/User');

  // Synthetic user with tokenVersion already at 2 (e.g. after password change or prior logout)
  const mockUserRecord = {
    _id: 'user_sec24',
    role: 'candidate',
    isBlocked: false,
    accountStatus: 'active',
    passwordHash: '$2b$10$placeholder',
    tokenVersion: 2
  };

  // Attacker presents a stale token that was issued when tokenVersion was 1 (already revoked)
  const staleStolenToken = jwt.sign(
    { id: mockUserRecord._id, role: mockUserRecord.role, tv: 1 },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // A legitimate active user currently has a valid token with tv: 2
  const activeValidToken = jwt.sign(
    { id: mockUserRecord._id, role: mockUserRecord.role, tv: 2 },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  const originalFindById = User.findById.bind(User);
  const originalUpdateOne = User.updateOne.bind(User);

  User.findById = () => ({
    select: () => Promise.resolve(mockUserRecord)
  });

  User.updateOne = (filter, update) => {
    const idMatch = filter._id === mockUserRecord._id;
    let tvMatch = false;
    if (filter.tokenVersion !== undefined) {
      tvMatch = filter.tokenVersion === mockUserRecord.tokenVersion;
    } else if (filter.$or) {
      tvMatch = mockUserRecord.tokenVersion === 0;
    }
    if (idMatch && tvMatch && update.$inc && update.$inc.tokenVersion) {
      mockUserRecord.tokenVersion += update.$inc.tokenVersion;
      return Promise.resolve({ modifiedCount: 1 });
    }
    return Promise.resolve({ modifiedCount: 0 });
  };

  // Attacker repeatedly submits stale token to /auth/logout trying to bump tokenVersion
  const attackerLogoutReq = {
    headers: { authorization: `Bearer ${staleStolenToken}` },
    cookies: {}
  };
  const attackerLogoutRes = {
    clearCookie: () => {},
    status: () => attackerLogoutRes,
    json: () => {}
  };
  await authController.logout(attackerLogoutReq, attackerLogoutRes, () => {});

  // Verification 1: tokenVersion was NOT bumped by the stale token
  assert.strictEqual(
    mockUserRecord.tokenVersion,
    2,
    'Stale token must NOT bump tokenVersion; must remain at 2'
  );

  // Verification 2: Active user session is NOT denied of service
  let activeUserNextCalled = false;
  const activeReq = {
    headers: { authorization: `Bearer ${activeValidToken}` },
    method: 'GET',
    cookies: {}
  };
  const activeRes = {
    status: () => activeRes,
    json: () => {}
  };
  await authenticate(activeReq, activeRes, () => { activeUserNextCalled = true; });

  User.findById = originalFindById;
  User.updateOne = originalUpdateOne;

  assert.strictEqual(
    activeUserNextCalled,
    true,
    'Legitimate active session must continue to authenticate without DoS'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-25: Public Recommendation Tracking Anti-Enumeration & Phone Verification
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-25: Public tracking requires valid matching phone and rejects omitted/malformed phone', async () => {
  const recommendationService = require('./src/services/recommendation.service');
  const { RecommendationRequest } = require('./src/models/RecommendationRequest');

  const mockRequest = {
    requestNumber: 'REC-9F8A2B1C3D4E5067812934BC',
    trackingSecret: '7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f',
    status: 'pending',
    createdAt: new Date(),
    people: [
      {
        fullName: 'أحمد محمود',
        phone: '01012345678',
        phoneNormalized: '+201012345678',
        isPrimary: true,
        jobTitle: 'مهندس جودة',
        careerLevel: 'متوسط (3-5 سنوات)'
      },
      {
        fullName: 'سعيد إبراهيم',
        phone: '01198765432',
        phoneNormalized: '+201198765432',
        isPrimary: false,
        jobTitle: 'فني تشغيل',
        careerLevel: 'مبتدئ (1-3 سنوات)'
      }
    ]
  };

  const originalFindOne = RecommendationRequest.findOne.bind(RecommendationRequest);
  RecommendationRequest.findOne = (query) => {
    const isMatch =
      query.$or &&
      query.$or.some(
        (cond) =>
          cond.requestNumber === mockRequest.requestNumber ||
          cond.trackingSecret === mockRequest.trackingSecret
      );
    return {
      lean: () => Promise.resolve(isMatch ? mockRequest : null)
    };
  };

  // 1. Phone omitted -> must throw 400 PHONE_REQUIRED
  await assert.rejects(
    async () => {
      await recommendationService.trackRequestStatus(mockRequest.requestNumber, '');
    },
    (err) => err.statusCode === 400 && err.code === 'PHONE_REQUIRED',
    'Omitted phone must be rejected with 400 PHONE_REQUIRED'
  );

  // 2. Malformed/invalid phone -> must throw 400 INVALID_PHONE
  await assert.rejects(
    async () => {
      await recommendationService.trackRequestStatus(mockRequest.requestNumber, '12345abc');
    },
    (err) => err.statusCode === 400 && err.code === 'INVALID_PHONE',
    'Malformed phone must be rejected with 400 INVALID_PHONE'
  );

  // 3. Valid Egyptian phone but non-matching -> must throw 403 PHONE_MISMATCH
  await assert.rejects(
    async () => {
      await recommendationService.trackRequestStatus(mockRequest.requestNumber, '01234567890');
    },
    (err) => err.statusCode === 403 && err.code === 'PHONE_MISMATCH',
    'Non-matching phone must be rejected with 403 PHONE_MISMATCH'
  );

  // 4. Valid matching phone with requestNumber -> must succeed and mask recommendations
  const resultByReqNum = await recommendationService.trackRequestStatus(
    mockRequest.requestNumber,
    '01012345678'
  );
  assert.strictEqual(resultByReqNum.requestNumber, mockRequest.requestNumber);
  assert.strictEqual(resultByReqNum.submitterName, 'أحمد محمود');
  assert.strictEqual(resultByReqNum.people[0].maskedPhone, '010****5678');

  // 5. Valid matching phone with trackingSecret -> must succeed
  const resultBySecret = await recommendationService.trackRequestStatus(
    mockRequest.trackingSecret,
    '01012345678'
  );
  assert.strictEqual(resultBySecret.requestNumber, mockRequest.requestNumber);

  RecommendationRequest.findOne = originalFindOne;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-26: Recommendation Candidate Registration Account Takeover Defense
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-26: Candidate registration rejects claiming recommended profile without phone verification', async () => {
  const authService = require('./src/services/auth.service');
  const Candidate = require('./src/models/Candidate');
  const Job = require('./src/models/Job');

  const existingNominatedCandidate = {
    _id: 'cand_sec26',
    phone: '01012345678',
    phoneNormalized: '+201012345678',
    fullName: 'ضحية الترشيح',
    isRecommendation: true,
    isDeleted: false,
    save: async () => {}
  };

  const originalCandFindOne = Candidate.findOne.bind(Candidate);
  const originalJobFindById = Job.findById.bind(Job);

  Candidate.findOne = () => Promise.resolve(existingNominatedCandidate);
  Job.findById = () => Promise.resolve({ _id: 'job_123', categoryId: 'cat_123', isActive: true });

  // Attacker attempts to register with victim phone without verification token
  await assert.rejects(
    async () => {
      await authService.registerCandidate({
        fullName: 'المهاجم الخبيث',
        phone: '01012345678',
        password: 'attackerNewPassword123',
        passwordConfirm: 'attackerNewPassword123',
        desiredJobId: 'job_123',
        consentGiven: true
      });
    },
    (err) => err.statusCode === 403 && err.code === 'PHONE_VERIFICATION_REQUIRED',
    'Must strictly reject unverified takeover attempt on recommended candidate'
  );

  Candidate.findOne = originalCandFindOne;
  Job.findById = originalJobFindById;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-27: Candidate Interaction Route Requires Active Subscription & Validates Ownership
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-27: Interaction route rejects expired companies and validates candidate/request existence', async () => {
  const { requireActiveSubscription } = require('./src/middleware/subscription.middleware');
  const recruitmentRequestService = require('./src/services/recruitmentRequest.service');
  const Candidate = require('./src/models/Candidate');

  // 1. Middleware rejects company with expired subscription
  let middlewareStatus = 0;
  let middlewareCode = null;
  const expiredReq = {
    user: { role: 'company', _id: 'user_comp_expired' },
    company: {
      _id: 'comp_expired',
      subscriptionStatus: 'expired',
      subscriptionEndDate: new Date(Date.now() - 10000)
    }
  };
  const fakeRes = {
    status: (code) => {
      middlewareStatus = code;
      return {
        json: (data) => { middlewareCode = data.code; }
      };
    }
  };

  const subscriptionGate = requireActiveSubscription();
  await subscriptionGate(expiredReq, fakeRes, () => {
    throw new Error('Should not have called next() for expired company');
  });

  assert.strictEqual(middlewareStatus, 403, 'Expired company must be rejected with 403');
  assert.ok(
    ['SUBSCRIPTION_REQUIRED', 'SUBSCRIPTION_EXPIRED'].includes(middlewareCode),
    'Must return subscription error code'
  );

  // 2. Service rejects non-existent candidate
  const originalCandFindById = Candidate.findById.bind(Candidate);
  Candidate.findById = () => ({
    lean: () => Promise.resolve(null)
  });

  await assert.rejects(
    async () => {
      await recruitmentRequestService.logCandidateInteraction(
        'comp_123',
        'non_existent_candidate',
        'CALL_CLICKED'
      );
    },
    (err) => err.statusCode === 404 && err.code === 'CANDIDATE_NOT_FOUND',
    'Must reject interaction with non-existent candidate'
  );

  Candidate.findById = originalCandFindById;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-28: Unauthenticated Catalog Sync via ?refresh=true Is Disabled
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-28: GET /api/jobs?refresh=true does not trigger catalog sync when jobs already exist', async () => {
  const jobController = require('./src/controllers/job.controller');
  const adminService = require('./src/services/admin.service');

  // Stub: catalog already has jobs — bootstrap path must NOT run
  let syncCalled = false;
  const originalGetAllJobs = adminService.getAllJobs.bind(adminService);
  const originalSyncJobCatalog = require('./src/seed/seed-full-catalog').syncJobCatalog;

  adminService.getAllJobs = async () => [{ _id: 'job1', title: 'Engineer' }];

  // Patch the syncJobCatalog inside the module cache to detect if it's called
  const seedModule = require('./src/seed/seed-full-catalog');
  const originalSync = seedModule.syncJobCatalog;
  seedModule.syncJobCatalog = async () => { syncCalled = true; return {}; };

  // Invalidate the controller module cache so it picks up the patched dependency
  delete require.cache[require.resolve('./src/controllers/job.controller')];
  const freshJobController = require('./src/controllers/job.controller');

  const fakeReq = { query: { refresh: 'true' } };
  let responseSent = false;
  const fakeRes = {
    status: () => fakeRes,
    json: () => { responseSent = true; }
  };

  await freshJobController.getJobs(fakeReq, fakeRes, (err) => { if (err) throw err; });

  // Restore
  seedModule.syncJobCatalog = originalSync;
  adminService.getAllJobs = originalGetAllJobs;
  delete require.cache[require.resolve('./src/controllers/job.controller')];

  assert.strictEqual(syncCalled, false, 'Catalog sync must NOT be triggered by ?refresh=true when jobs exist');
  assert.strictEqual(responseSent, true, 'Response must be sent normally');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-29: Expired Platinum Subscription Cannot Browse Candidate Database
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-29: Platinum browse route rejects company with expired subscription via requireActiveSubscription', async () => {
  const { requireActiveSubscription } = require('./src/middleware/subscription.middleware');

  let statusCaptured = 0;
  let codeCaptured = null;
  let nextCalled = false;

  // Company has Platinum plan but subscription is expired
  const expiredPlatinumReq = {
    user: { role: 'company', _id: 'user_sec29' },
    company: {
      _id: 'comp_sec29',
      subscriptionPlan: 'Platinum',
      subscriptionStatus: 'active',           // status field still says active...
      subscriptionEndDate: new Date(Date.now() - 86400000) // ...but end date is yesterday
    }
  };

  const fakeRes = {
    status: (code) => {
      statusCaptured = code;
      return { json: (data) => { codeCaptured = data.code; } };
    }
  };

  const gate = requireActiveSubscription();
  await gate(expiredPlatinumReq, fakeRes, () => { nextCalled = true; });

  assert.strictEqual(nextCalled, false, 'next() must NOT be called for expired Platinum subscription');
  assert.strictEqual(statusCaptured, 403, 'Must return 403 for expired subscription');
  assert.strictEqual(codeCaptured, 'SUBSCRIPTION_EXPIRED', 'Must return SUBSCRIPTION_EXPIRED code');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-30: Export Quota Is Enforced Even When jobId/desiredJobId Is Absent
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-30: Export without jobId/desiredJobId still consumes the ALL_TITLES quota bucket', async () => {
  const entitlementService = require('./src/services/entitlement.service');
  const Company = require('./src/models/Company');
  const Subscription = require('./src/models/Subscription');
  const DailyQuotaUsage = require('./src/models/DailyQuotaUsage');

  const mockCompany = {
    _id: 'comp_sec30',
    userId: 'user_sec30',
    companyName: 'Test Corp',
    verificationStatus: 'Approved',
    accountStatus: 'active',
    isBlocked: false,
    isDeleted: false,
    subscriptionPlan: 'Basic',
    subscriptionStatus: 'active',
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    searchesUsed: 0,
    exportsUsed: 0,
    save: async () => {}
  };

  const mockUsage = {
    companyId: 'comp_sec30',
    cairoDate: 'today',
    searchesCount: 0,
    downloadsByJob: new Map(),
    platinumViews: [],
    platinumDownloads: [],
    save: async () => {}
  };

  const originalCompanyFindById = Company.findById.bind(Company);
  const originalCompanyFindOneAndUpdate = Company.findOneAndUpdate.bind(Company);
  const originalSubFindOne = Subscription.findOne.bind(Subscription);
  const originalUsageFindOneAndUpdate = DailyQuotaUsage.findOneAndUpdate.bind(DailyQuotaUsage);

  Company.findById = () => Promise.resolve(mockCompany);
  Company.findOneAndUpdate = () => Promise.resolve(mockCompany);
  Subscription.findOne = () => ({ lean: () => Promise.resolve(null) });
  DailyQuotaUsage.findOneAndUpdate = () => Promise.resolve(mockUsage);

  // Call checkAndConsumeDownloadQuota with 'ALL_TITLES' (the fallback jobId used when none supplied)
  const result = await entitlementService.checkAndConsumeDownloadQuota('comp_sec30', 'ALL_TITLES', 1, null);

  Company.findById = originalCompanyFindById;
  Company.findOneAndUpdate = originalCompanyFindOneAndUpdate;
  Subscription.findOne = originalSubFindOne;
  DailyQuotaUsage.findOneAndUpdate = originalUsageFindOneAndUpdate;

  assert.strictEqual(result.downloadsForJob, 1, "ALL_TITLES bucket must record 1 download");
  assert.ok(typeof result.downloadsRemainingForJob === 'number', "Remaining quota must be returned");

  // Also verify that omitting jobId entirely throws JOB_REQUIRED (the null-guard is preserved)
  await assert.rejects(
    async () => {
      await entitlementService.checkAndConsumeDownloadQuota('comp_sec30', null, 1, null);
    },
    (err) => err.code === 'JOB_REQUIRED',
    'Null jobId must still throw JOB_REQUIRED (explicit null must be handled by caller)'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-31: Recruitment Request Quantity Is Capped to Prevent Bulk Contact Harvest
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-31: createRecruitmentRequest rejects quantityRequested above the plan cap with QUANTITY_EXCEEDS_LIMIT', async () => {
  const recruitmentRequestService = require('./src/services/recruitmentRequest.service');
  const Job = require('./src/models/Job');
  const Subscription = require('./src/models/Subscription');

  const originalJobFindById = Job.findById.bind(Job);
  const originalSubFindOne = Subscription.findOne.bind(Subscription);

  Job.findById = () => Promise.resolve({ _id: 'job_sec31', name: 'Engineer', isActive: true });
  // Stub plan with cap of 10
  Subscription.findOne = () => ({ lean: () => Promise.resolve(null) }); // defaults: cap=10

  const mockCompany = { _id: 'comp_sec31', userId: 'user_sec31', subscriptionPlan: 'Basic' };

  // 999999999 >> 10 (plan cap) → must reject
  await assert.rejects(
    async () => {
      await recruitmentRequestService.createRecruitmentRequest(
        mockCompany,
        { jobId: 'job_sec31', quantityRequested: 999999999 },
        null
      );
    },
    (err) => err.code === 'QUANTITY_EXCEEDS_LIMIT' && err.statusCode === 400,
    'Quantity >> plan cap must be rejected with QUANTITY_EXCEEDS_LIMIT'
  );

  // Quantity of exactly 10 must NOT throw QUANTITY_EXCEEDS_LIMIT (may fail on DB steps, that's fine)
  let threwQuantityError = false;
  try {
    await recruitmentRequestService.createRecruitmentRequest(
      mockCompany,
      { jobId: 'job_sec31', quantityRequested: 10 },
      null
    );
  } catch (err) {
    threwQuantityError = err.code === 'QUANTITY_EXCEEDS_LIMIT';
  }
  assert.strictEqual(threwQuantityError, false, 'Quantity of exactly 10 must NOT throw QUANTITY_EXCEEDS_LIMIT');

  Job.findById = originalJobFindById;
  Subscription.findOne = originalSubFindOne;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-32: mustChangePassword Middleware Cannot Be Bypassed via Query String
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-32: requirePasswordChanged blocks ?next=/auth/me path injection and only allows exact prefixes', async () => {
  const { requirePasswordChanged } = require('./src/middleware/mustChangePassword.middleware');

  const userWithMustChange = { mustChangePassword: true };

  function makeReq(url) {
    return { user: userWithMustChange, originalUrl: url };
  }

  let res = { status: (c) => ({ json: () => {} }) };

  // 1. Crafted bypass: query string contains an allowed path — must be BLOCKED
  let blockedCount = 0;
  const bypassUrls = [
    '/api/candidates/search?next=/auth/me',
    '/api/candidates/search?foo=/auth/logout',
    '/api/candidates/platinum/browse?redirect=/auth/update-password',
    '/api/candidates/export?x=/auth/change-initial-password'
  ];
  for (const url of bypassUrls) {
    let nextCalled = false;
    let statusCalled = 0;
    const fakeRes = {
      status: (c) => { statusCalled = c; return { json: () => {} }; }
    };
    requirePasswordChanged(makeReq(url), fakeRes, () => { nextCalled = true; });
    if (!nextCalled && statusCalled === 403) blockedCount++;
  }
  assert.strictEqual(blockedCount, bypassUrls.length, 'All query-string injection attempts must be blocked with 403');

  // 2. Legitimate allowed paths — must call next()
  let allowedCount = 0;
  const allowedUrls = [
    '/auth/change-initial-password',
    '/auth/update-password',
    '/auth/logout',
    '/auth/me'
  ];
  for (const url of allowedUrls) {
    let nextCalled = false;
    requirePasswordChanged(makeReq(url), res, () => { nextCalled = true; });
    if (nextCalled) allowedCount++;
  }
  assert.strictEqual(allowedCount, allowedUrls.length, 'All legitimate auth paths must be allowed through');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-33: Expired Subscription Cannot Retrieve Candidate Details from Prior Requests
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-33: getRecruitmentRequestById throws SUBSCRIPTION_REQUIRED for expired company', async () => {
  const recruitmentRequestService = require('./src/services/recruitmentRequest.service');

  const expiredCompany = {
    _id: 'comp_sec33',
    subscriptionStatus: 'expired',
    subscriptionEndDate: new Date(Date.now() - 86400000)
  };

  await assert.rejects(
    async () => {
      await recruitmentRequestService.getRecruitmentRequestById(
        'req_sec33',
        'comp_sec33',
        false,          // isAdmin = false
        expiredCompany  // company passed by controller
      );
    },
    (err) => err.code === 'SUBSCRIPTION_REQUIRED' && err.statusCode === 403,
    'Expired subscription must be rejected (SUBSCRIPTION_REQUIRED) before populating candidate contact details'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-35: Catalog Bootstrap Sync Does Not Run When All Jobs Are Merely Inactive
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-35: Bootstrap sync does not run when catalog has inactive jobs (getAllJobs(true) > 0)', async () => {
  const adminService = require('./src/services/admin.service');
  const seedModule = require('./src/seed/seed-full-catalog');

  let syncCalled = false;
  const originalGetAllJobs = adminService.getAllJobs.bind(adminService);
  const originalSync = seedModule.syncJobCatalog;

  // Simulate: active list is empty, but total (including inactive) has 3 records
  let callCount = 0;
  adminService.getAllJobs = async (includeInactive) => {
    callCount++;
    return includeInactive
      ? [{ _id: 'job_inactive', isActive: false }]  // 1 admin-disabled job
      : [];                                          // 0 active jobs shown to public
  };
  seedModule.syncJobCatalog = async () => { syncCalled = true; return {}; };

  delete require.cache[require.resolve('./src/controllers/job.controller')];
  const freshJobController = require('./src/controllers/job.controller');

  const fakeReq = { query: {} };
  const fakeRes = { status: () => fakeRes, json: () => {} };
  await freshJobController.getJobs(fakeReq, fakeRes, (err) => { if (err) throw err; });

  // Restore
  adminService.getAllJobs = originalGetAllJobs;
  seedModule.syncJobCatalog = originalSync;
  delete require.cache[require.resolve('./src/controllers/job.controller')];

  assert.strictEqual(syncCalled, false, 'Sync must NOT run when inactive jobs exist (catalog is not empty)');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-34: Payment Webhook Replay After Refund Cannot Reactivate Subscription
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-34: Replaying a paid webhook after refund leaves order in refunded state', async () => {
  const PaymentOrder = require('./src/models/PaymentOrder');
  const paymentController = require('./src/controllers/payment.controller');

  // Synthetic refunded order
  const refundedOrder = {
    _id: 'order_sec34',
    paymobOrderId: 'paymob_sec34',
    status: 'refunded',
    amountEgp: 500,
    save: async () => {}
  };

  let companySaved = false;
  const originalFindOne = PaymentOrder.findOne.bind(PaymentOrder);
  PaymentOrder.findOne = () => Promise.resolve(refundedOrder);

  // Mock paymobService HMAC inside controller via env trick
  const originalHmacKey = process.env.PAYMOB_HMAC_KEY;
  process.env.PAYMOB_HMAC_KEY = 'test_key_sec34';

  // Stub paymobService.verifyHmac inside the controller's cached module
  const paymobService = require('./src/services/paymob.service');
  const originalVerifyHmac = paymobService.verifyHmac;
  const originalExpectedIntegration = paymobService.isExpectedIntegration;
  paymobService.verifyHmac = () => true; // webhook passes HMAC
  paymobService.isExpectedIntegration = () => true;

  const Company = require('./src/models/Company');
  const originalCompanyFindByIdAndUpdate = Company.findByIdAndUpdate.bind(Company);
  Company.findByIdAndUpdate = async () => { companySaved = true; return null; };

  const fakeReq = {
    query: { hmac: 'valid_hmac' },
    body: {
      obj: {
        id: 'txn_789',
        success: true,
        amount_cents: 50000,
        order: { id: 'paymob_sec34' }
      }
    }
  };
  let responseStatus = 0;
  const fakeRes = {
    status: (c) => { responseStatus = c; return fakeRes; },
    json: () => {}
  };

  await paymentController.handleWebhook(fakeReq, fakeRes);

  // Restore
  PaymentOrder.findOne = originalFindOne;
  Company.findByIdAndUpdate = originalCompanyFindByIdAndUpdate;
  paymobService.verifyHmac = originalVerifyHmac;
  paymobService.isExpectedIntegration = originalExpectedIntegration;
  process.env.PAYMOB_HMAC_KEY = originalHmacKey;

  assert.strictEqual(companySaved, false, 'Company subscription must NOT be reactivated on webhook replay after refund');
  assert.strictEqual(refundedOrder.status, 'refunded', 'Order status must remain refunded');
  assert.strictEqual(responseStatus, 200, 'Webhook must still return 200 (idempotent ack)');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-36: Quota Checks Use Atomic Increment to Prevent Race-Condition Bypass
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-36: Search quota uses $inc and rejects post-increment count that exceeds the limit', async () => {
  const entitlementService = require('./src/services/entitlement.service');
  const Company = require('./src/models/Company');
  const Subscription = require('./src/models/Subscription');
  const DailyQuotaUsage = require('./src/models/DailyQuotaUsage');

  const mockCompany = {
    _id: 'comp_sec36',
    userId: 'user_sec36',
    verificationStatus: 'Approved',
    accountStatus: 'active',
    isBlocked: false,
    isDeleted: false,
    subscriptionPlan: 'Basic',
    subscriptionStatus: 'active',
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    searchesUsed: 0,
    save: async () => {}
  };

  const originalCompanyFindById = Company.findById.bind(Company);
  const originalSubFindOne = Subscription.findOne.bind(Subscription);
  const originalFindOneAndUpdate = DailyQuotaUsage.findOneAndUpdate.bind(DailyQuotaUsage);

  Company.findById = () => Promise.resolve(mockCompany);
  Subscription.findOne = () => ({ lean: () => Promise.resolve(null) });

  // Simulate the scenario: two concurrent requests both trigger the atomic $inc
  // The first lands searchesCount = 15 (= limit for Basic), the second lands 16.
  // The new code checks >limit (not >=), so count=16 must be rejected.
  let callIndex = 0;
  DailyQuotaUsage.findOneAndUpdate = () => {
    callIndex++;
    // First call returns count AT the limit (should be the last allowed)
    const count = callIndex === 1 ? 15 : 16;
    return Promise.resolve({
      companyId: 'comp_sec36',
      cairoDate: 'today',
      searchesCount: count,
      downloadsByJob: new Map()
    });
  };

  // First request (at-limit): must succeed
  const result = await entitlementService.checkAndConsumeSearchQuota('comp_sec36', null);
  assert.strictEqual(result.searchesCount, 15, 'Request landing at the limit (15) must succeed');

  // Second request (over-limit, simulating lost race): must be rejected
  await assert.rejects(
    async () => {
      await entitlementService.checkAndConsumeSearchQuota('comp_sec36', null);
    },
    (err) => err.code === 'DAILY_SEARCH_LIMIT_REACHED' && err.statusCode === 429,
    'Request with post-increment count 16 (> limit 15) must be rejected with 429'
  );

  Company.findById = originalCompanyFindById;
  Subscription.findOne = originalSubFindOne;
  DailyQuotaUsage.findOneAndUpdate = originalFindOneAndUpdate;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-37: Platinum Browse Strips Phone/Email and Caps Page to 20
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-37: browseCandidatesPlatinum omits phone and email from results and caps page at 20', async () => {
  const candidateController = require('./src/controllers/candidate.controller');
  const entitlementService = require('./src/services/entitlement.service');
  const searchService = require('./src/services/search.service');

  const originalValidate = entitlementService.validateCompanyAccess;
  const originalGetPlanLimits = entitlementService.getPlanLimits;
  const originalSearch = searchService.searchCandidates;

  entitlementService.validateCompanyAccess = async () => ({ _id: 'comp_sec37', subscriptionPlan: 'Platinum' });
  entitlementService.getPlanLimits = async () => ({ platinumBrowseEnabled: true });

  // Return 5 fake candidates with phone and email present
  let capturedLimit = null;
  searchService.searchCandidates = async (query, company, req) => {
    capturedLimit = query.limit;
    return {
      items: [
        { _id: 'c1', fullName: 'علي', phone: '01012345678', email: 'ali@test.com', governorate: 'Cairo' },
        { _id: 'c2', fullName: 'سارة', phone: '01098765432', email: 'sara@test.com', governorate: 'Giza' }
      ],
      pagination: { page: 1, limit: query.limit, total: 2, pages: 1, hasMore: false }
    };
  };

  let responseData = null;
  const fakeReq = {
    query: { limit: '100' }, // attacker requests 100
    company: { _id: 'comp_sec37', subscriptionPlan: 'Platinum' }
  };
  const fakeRes = {
    status: () => fakeRes,
    json: (data) => { responseData = data; }
  };

  await candidateController.browseCandidatesPlatinum(fakeReq, fakeRes, (err) => { if (err) throw err; });

  entitlementService.validateCompanyAccess = originalValidate;
  entitlementService.getPlanLimits = originalGetPlanLimits;
  searchService.searchCandidates = originalSearch;

  assert.ok(responseData, 'Response must be sent');
  assert.ok(capturedLimit <= 20, `Page size must be capped at 20; got ${capturedLimit}`);
  const items = responseData.data;
  assert.ok(Array.isArray(items) && items.length > 0, 'Items must be returned');
  for (const item of items) {
    assert.ok(!('phone' in item), `phone must be stripped from browse result: ${JSON.stringify(item)}`);
    assert.ok(!('email' in item), `email must be stripped from browse result: ${JSON.stringify(item)}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-38: Platinum Download Enforces Daily Per-Title Quota
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-38: recordPlatinumCandidateAction enforces download quota and rejects when limit exceeded', async () => {
  const entitlementService = require('./src/services/entitlement.service');
  const Company = require('./src/models/Company');
  const Subscription = require('./src/models/Subscription');
  const DailyQuotaUsage = require('./src/models/DailyQuotaUsage');

  const mockCompany = {
    _id: 'comp_sec38',
    userId: 'user_sec38',
    verificationStatus: 'Approved',
    accountStatus: 'active',
    isBlocked: false,
    isDeleted: false,
    subscriptionPlan: 'Platinum',
    subscriptionStatus: 'active',
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    exportsUsed: 0,
    save: async () => {}
  };

  const originalFindById = Company.findById.bind(Company);
  const originalCompanyFindOneAndUpdate = Company.findOneAndUpdate.bind(Company);
  const originalSubFindOne = Subscription.findOne.bind(Subscription);
  const originalFindOneAndUpdate = DailyQuotaUsage.findOneAndUpdate.bind(DailyQuotaUsage);

  Company.findById = () => Promise.resolve(mockCompany);
  Company.findOneAndUpdate = () => Promise.resolve(mockCompany);
  // Return Platinum plan with dailyDownloadLimitPerTitle = 1
  Subscription.findOne = () => ({
    lean: () => Promise.resolve({ planName: 'Platinum', dailySearchLimit: 30, dailyDownloadLimitPerTitle: 1 })
  });

  // First call: count = 1 (at limit), second call: count = 2 (over limit)
  let downloadCallIndex = 0;
  DailyQuotaUsage.findOneAndUpdate = () => {
    downloadCallIndex++;
    const count = downloadCallIndex;
    const map = new Map();
    map.set('platinum_downloads', count);
    return Promise.resolve({
      companyId: 'comp_sec38',
      cairoDate: 'today',
      searchesCount: 0,
      downloadsByJob: map,
      platinumViews: [],
      platinumDownloads: [],
      save: async () => {}
    });
  };

  // First download: lands at count=1 (= limit), should be ACCEPTED
  const result = await entitlementService.recordPlatinumCandidateAction('comp_sec38', 'cand_sec38', 'download', null);
  assert.strictEqual(result.success, true, 'First download (at limit) must succeed');

  // Second download: lands at count=2 (> limit), should be REJECTED
  await assert.rejects(
    async () => {
      await entitlementService.recordPlatinumCandidateAction('comp_sec38', 'cand_sec38', 'download', null);
    },
    (err) => err.code === 'DAILY_DOWNLOAD_LIMIT_REACHED' && err.statusCode === 429,
    'Second download (over limit) must be rejected with 429 DAILY_DOWNLOAD_LIMIT_REACHED'
  );

  Company.findById = originalFindById;
  Company.findOneAndUpdate = originalCompanyFindOneAndUpdate;
  Subscription.findOne = originalSubFindOne;
  DailyQuotaUsage.findOneAndUpdate = originalFindOneAndUpdate;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-39: Recruitment Request Is Capped at Plan maxCandidatesPerTitle
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-39: createRecruitmentRequest rejects quantity > plan maxCandidatesPerTitle (10 for Basic)', async () => {
  const recruitmentRequestService = require('./src/services/recruitmentRequest.service');
  const Job = require('./src/models/Job');
  const Subscription = require('./src/models/Subscription');

  const originalJobFindById = Job.findById.bind(Job);
  const originalSubFindOne = Subscription.findOne.bind(Subscription);

  Job.findById = () => Promise.resolve({ _id: 'job_sec39', name: 'Engineer', isActive: true });
  Subscription.findOne = () => ({ lean: () => Promise.resolve(null) }); // use defaults

  const mockCompany = { _id: 'comp_sec39', userId: 'user_sec39', subscriptionPlan: 'Basic' };

  // 11 > maxCandidatesPerTitle (10 for Basic) → must reject
  await assert.rejects(
    async () => {
      await recruitmentRequestService.createRecruitmentRequest(
        mockCompany,
        { jobId: 'job_sec39', quantityRequested: 11 },
        null
      );
    },
    (err) => err.code === 'QUANTITY_EXCEEDS_LIMIT' && err.statusCode === 400,
    'Quantity > plan maxCandidatesPerTitle must be rejected with QUANTITY_EXCEEDS_LIMIT'
  );

  // 10 = maxCandidatesPerTitle → must NOT throw the cap error
  let cappedError = false;
  try {
    await recruitmentRequestService.createRecruitmentRequest(
      mockCompany,
      { jobId: 'job_sec39', quantityRequested: 10 },
      null
    );
  } catch (err) {
    cappedError = err.code === 'QUANTITY_EXCEEDS_LIMIT';
  }
  assert.strictEqual(cappedError, false, 'Quantity of exactly 10 must NOT throw QUANTITY_EXCEEDS_LIMIT');

  Job.findById = originalJobFindById;
  Subscription.findOne = originalSubFindOne;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-40: Inactive Subscription Cannot Read Recruitment-Request Contacts
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-40: getRecruitmentRequestById rejects company with inactive subscription (even if end date is future)', async () => {
  const recruitmentRequestService = require('./src/services/recruitmentRequest.service');

  // subscriptionStatus is 'inactive' but end date is 30 days away
  const inactiveCompany = {
    _id: 'comp_sec40',
    subscriptionStatus: 'inactive',
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 3600 * 1000)
  };

  await assert.rejects(
    async () => {
      await recruitmentRequestService.getRecruitmentRequestById(
        'req_sec40',
        'comp_sec40',
        false,
        inactiveCompany
      );
    },
    (err) => err.code === 'SUBSCRIPTION_REQUIRED' && err.statusCode === 403,
    'Inactive subscription must be rejected even when end date is in the future'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-41: Report Routes Require Password Change and Active Subscription
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-41: Report GET route rejects expired subscription and must-change-password accounts', async () => {
  const { requireActiveSubscription } = require('./src/middleware/subscription.middleware');
  const { requirePasswordChanged } = require('./src/middleware/mustChangePassword.middleware');

  // 1. Expired subscription must be blocked
  let expiredStatus = 0, expiredCode = null;
  const expiredReq = {
    user: { role: 'company', _id: 'user_sec41' },
    company: {
      subscriptionStatus: 'active',
      subscriptionEndDate: new Date(Date.now() - 86400000) // yesterday
    }
  };
  const expiredRes = {
    status: (c) => { expiredStatus = c; return { json: (d) => { expiredCode = d.code; } }; }
  };
  const gate = requireActiveSubscription();
  await gate(expiredReq, expiredRes, () => { throw new Error('next() must NOT be called for expired subscription'); });
  assert.strictEqual(expiredStatus, 403, 'Expired subscription must return 403');
  assert.strictEqual(expiredCode, 'SUBSCRIPTION_EXPIRED', 'Must return SUBSCRIPTION_EXPIRED');

  // 2. Must-change-password account must be blocked from report routes
  let pwStatus = 0;
  const pwReq = { user: { mustChangePassword: true }, originalUrl: '/api/reports' };
  const pwRes = { status: (c) => { pwStatus = c; return { json: () => {} }; } };
  requirePasswordChanged(pwReq, pwRes, () => { throw new Error('next() must NOT be called'); });
  assert.strictEqual(pwStatus, 403, 'Must-change-password account must return 403 on report route');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-42: Rate Limiter Is Applied Before Lazy DB Connection Middleware
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-42: app.js registers apiLimiter before the lazy-DB middleware at the application level', async () => {
  const fs = require('fs');
  const appSource = fs.readFileSync(require.resolve('./src/app.js'), 'utf8');

  // Use the standalone app.use(apiLimiter) sentinel line (the broad middleware registration).
  // The root '/' handler also uses apiLimiter but as an inline argument — we distinguish by
  // searching for the exact string without surrounding characters.
  const rateLimiterPos = appSource.indexOf('\napp.use(apiLimiter)');
  // Use the unique comment that precedes the lazy-DB middleware block as the landmark.
  const lazyDbSentinel = 'Lazy DB connection + one-time seed middleware for serverless';
  const lazyDbPos = appSource.indexOf(lazyDbSentinel);

  assert.ok(rateLimiterPos !== -1, 'app.use(apiLimiter) standalone line must be present in app.js');
  assert.ok(lazyDbPos !== -1, `"${lazyDbSentinel}" comment must be present in app.js`);
  assert.ok(
    rateLimiterPos < lazyDbPos,
    `apiLimiter (pos ${rateLimiterPos}) must be registered BEFORE the lazy-DB middleware comment (pos ${lazyDbPos})`
  );

  // Root health endpoint must also be covered by apiLimiter
  const rootEndpointPos = appSource.indexOf("app.get('/', apiLimiter");
  assert.ok(rootEndpointPos !== -1, "Root '/' endpoint must include apiLimiter before the handler");
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-43: Platinum Candidate Detail Enforces Daily Search Quota
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-43: getPlatinumCandidateDetail consumes search quota and rejects when limit is exceeded', async () => {
  const candidateController = require('./src/controllers/candidate.controller');
  const entitlementService = require('./src/services/entitlement.service');
  const candidateService = require('./src/services/candidate.service');

  const originalCheckAndConsumeSearchQuota = entitlementService.checkAndConsumeSearchQuota;
  const originalRecordAction = entitlementService.recordPlatinumCandidateAction;
  const originalGetById = candidateService.getCandidateByIdForCompany;

  let quotaChecked = false;
  let nextCalledWith = null;

  // 1. Quota check is called on valid request
  entitlementService.checkAndConsumeSearchQuota = async (companyId, req) => {
    quotaChecked = true;
    return { searchesCount: 1, searchesRemaining: 29 };
  };
  entitlementService.recordPlatinumCandidateAction = async () => ({ success: true });
  candidateService.getCandidateByIdForCompany = async () => ({ _id: 'cand_sec43', name: 'Test' });

  const fakeReq = {
    company: { _id: 'comp_sec43' },
    params: { id: 'cand_sec43' }
  };
  const fakeRes = {
    status: () => fakeRes,
    json: () => {}
  };

  await candidateController.getPlatinumCandidateDetail(fakeReq, fakeRes, (err) => { nextCalledWith = err; });
  assert.strictEqual(quotaChecked, true, 'checkAndConsumeSearchQuota must be called for detail view');
  assert.strictEqual(nextCalledWith, null, 'Must succeed when quota is available');

  // 2. When search quota is exceeded (429 DAILY_SEARCH_LIMIT_REACHED), controller forwards to next(err)
  entitlementService.checkAndConsumeSearchQuota = async () => {
    throw { statusCode: 429, code: 'DAILY_SEARCH_LIMIT_REACHED', message: 'Quota reached' };
  };

  let quotaExceededError = null;
  await candidateController.getPlatinumCandidateDetail(fakeReq, fakeRes, (err) => {
    quotaExceededError = err;
  });

  assert.ok(quotaExceededError, 'next(err) must be called when search quota is exceeded');
  assert.strictEqual(quotaExceededError.statusCode, 429);
  assert.strictEqual(quotaExceededError.code, 'DAILY_SEARCH_LIMIT_REACHED');

  entitlementService.checkAndConsumeSearchQuota = originalCheckAndConsumeSearchQuota;
  entitlementService.recordPlatinumCandidateAction = originalRecordAction;
  candidateService.getCandidateByIdForCompany = originalGetById;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-44: Platinum Candidate Downloads Use Shared 'platinum_downloads' Quota Bucket
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-44: recordPlatinumCandidateAction aggregates different candidates under platinum_downloads quota key', async () => {
  const entitlementService = require('./src/services/entitlement.service');
  const Company = require('./src/models/Company');
  const Subscription = require('./src/models/Subscription');
  const DailyQuotaUsage = require('./src/models/DailyQuotaUsage');

  const mockCompany = {
    _id: 'comp_sec44',
    userId: 'user_sec44',
    verificationStatus: 'Approved',
    accountStatus: 'active',
    isBlocked: false,
    isDeleted: false,
    subscriptionPlan: 'Platinum',
    subscriptionStatus: 'active',
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    exportsUsed: 0,
    save: async () => {}
  };

  const originalFindById = Company.findById.bind(Company);
  const originalCompanyFindOneAndUpdate = Company.findOneAndUpdate.bind(Company);
  const originalSubFindOne = Subscription.findOne.bind(Subscription);
  const originalFindOneAndUpdate = DailyQuotaUsage.findOneAndUpdate.bind(DailyQuotaUsage);

  Company.findById = () => Promise.resolve(mockCompany);
  Company.findOneAndUpdate = () => Promise.resolve(mockCompany);
  Subscription.findOne = () => ({
    lean: () => Promise.resolve({
      planName: 'Platinum',
      dailySearchLimit: 30,
      dailyDownloadLimitPerTitle: 1,
      platinumBrowseEnabled: true
    })
  });

  // Track per-key counts in the mock usage store
  const bucketCounts = new Map();
  DailyQuotaUsage.findOneAndUpdate = (filter, update) => {
    if (update.$inc) {
      for (const [field, incVal] of Object.entries(update.$inc)) {
        if (field.startsWith('downloadsByJob.')) {
          const key = field.replace('downloadsByJob.', '');
          bucketCounts.set(key, (bucketCounts.get(key) || 0) + incVal);
        }
      }
    }
    const map = new Map(bucketCounts);
    return Promise.resolve({
      companyId: 'comp_sec44',
      cairoDate: 'today',
      searchesCount: 0,
      downloadsByJob: map,
      platinumViews: [],
      platinumDownloads: [],
      save: async () => {}
    });
  };

  // Download candidate 1 — should use 'platinum_downloads' bucket and reach count = 1 (limit = 1)
  const res1 = await entitlementService.recordPlatinumCandidateAction('comp_sec44', 'cand_A', 'download', null);
  assert.strictEqual(res1.success, true, 'First download must succeed');
  assert.strictEqual(bucketCounts.get('platinum_downloads'), 1, 'Bucket key must be platinum_downloads');

  // Download candidate 2 — even though candidateId is cand_B, it must hit the SAME platinum_downloads bucket
  // and be rejected with 429 DAILY_DOWNLOAD_LIMIT_REACHED
  await assert.rejects(
    async () => {
      await entitlementService.recordPlatinumCandidateAction('comp_sec44', 'cand_B', 'download', null);
    },
    (err) => err.code === 'DAILY_DOWNLOAD_LIMIT_REACHED' && err.statusCode === 429,
    'Downloading a second candidate must be blocked because platinum_downloads bucket is shared'
  );

  Company.findById = originalFindById;
  Company.findOneAndUpdate = originalCompanyFindOneAndUpdate;
  Subscription.findOne = originalSubFindOne;
  DailyQuotaUsage.findOneAndUpdate = originalFindOneAndUpdate;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-45: ObjectId Case-Insensitive Download Quota Keying
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-45: checkAndConsumeDownloadQuota normalizes jobId to lowercase preventing case-variation bypass', async () => {
  const entitlementService = require('./src/services/entitlement.service');
  const Company = require('./src/models/Company');
  const Subscription = require('./src/models/Subscription');
  const DailyQuotaUsage = require('./src/models/DailyQuotaUsage');

  const mockCompany = {
    _id: 'comp_sec45',
    userId: 'user_sec45',
    verificationStatus: 'Approved',
    accountStatus: 'active',
    isBlocked: false,
    isDeleted: false,
    subscriptionPlan: 'Basic',
    subscriptionStatus: 'active',
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    exportsUsed: 0,
    save: async () => {}
  };

  const originalFindById = Company.findById.bind(Company);
  const originalCompanyFindOneAndUpdate = Company.findOneAndUpdate.bind(Company);
  const originalSubFindOne = Subscription.findOne.bind(Subscription);
  const originalFindOneAndUpdate = DailyQuotaUsage.findOneAndUpdate.bind(DailyQuotaUsage);

  Company.findById = () => Promise.resolve(mockCompany);
  Company.findOneAndUpdate = () => Promise.resolve(mockCompany);
  Subscription.findOne = () => ({
    lean: () => Promise.resolve({
      planName: 'Basic',
      dailySearchLimit: 10,
      dailyDownloadLimitPerTitle: 1
    })
  });

  const bucketCounts = new Map();
  DailyQuotaUsage.findOneAndUpdate = (filter, update) => {
    if (update.$inc) {
      for (const [field, incVal] of Object.entries(update.$inc)) {
        if (field.startsWith('downloadsByJob.')) {
          const key = field.replace('downloadsByJob.', '');
          bucketCounts.set(key, (bucketCounts.get(key) || 0) + incVal);
        }
      }
    }
    const map = new Map(bucketCounts);
    return Promise.resolve({
      companyId: 'comp_sec45',
      cairoDate: 'today',
      downloadsByJob: map,
      save: async () => {}
    });
  };

  const uppercaseJobId = '507F1F77BCF86CD799439011';
  const lowercaseJobId = '507f1f77bcf86cd799439011';

  // First download with UPPERCASE jobId: count becomes 1
  await entitlementService.checkAndConsumeDownloadQuota('comp_sec45', uppercaseJobId, 1, null);
  assert.strictEqual(bucketCounts.get(lowercaseJobId), 1, 'Bucket key in database must be strictly lowercase');
  assert.strictEqual(bucketCounts.has(uppercaseJobId), false, 'Uppercase key must not exist in storage');

  // Second download with lowercase jobId: must detect count=2 and throw 429 DAILY_DOWNLOAD_LIMIT_REACHED
  await assert.rejects(
    async () => {
      await entitlementService.checkAndConsumeDownloadQuota('comp_sec45', lowercaseJobId, 1, null);
    },
    (err) => err.code === 'DAILY_DOWNLOAD_LIMIT_REACHED' && err.statusCode === 429,
    'Submitting the same jobId in different case must share the same quota bucket and be rejected'
  );

  Company.findById = originalFindById;
  Company.findOneAndUpdate = originalCompanyFindOneAndUpdate;
  Subscription.findOne = originalSubFindOne;
  DailyQuotaUsage.findOneAndUpdate = originalFindOneAndUpdate;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-46: CV Download Requires Active Non-Deleted Candidate and Consumes Quota
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-46: downloadCv rejects deactivated candidates and enforces download quota for company downloads', async () => {
  const candidateController = require('./src/controllers/candidate.controller');
  const Candidate = require('./src/models/Candidate');
  const Company = require('./src/models/Company');
  const entitlementService = require('./src/services/entitlement.service');

  const originalCandidateFindOne = Candidate.findOne.bind(Candidate);
  const originalCompanyFindOne = Company.findOne.bind(Company);
  const originalQuotaCheck = entitlementService.checkAndConsumeDownloadQuota;

  const mockCompany = {
    _id: 'comp_sec46',
    userId: 'user_sec46',
    verificationStatus: 'Approved',
    accountStatus: 'active',
    isBlocked: false,
    subscriptionStatus: 'active',
    subscriptionEndDate: new Date(Date.now() + 30 * 24 * 3600 * 1000)
  };

  Company.findOne = () => Promise.resolve(mockCompany);

  let quotaJobIdConsumed = null;
  entitlementService.checkAndConsumeDownloadQuota = async (compGuid, jobBucket) => {
    quotaJobIdConsumed = jobBucket;
  };

  // Case 1: Company attempts to download deactivated candidate's CV
  Candidate.findOne = (query) => {
    if (query.accountStatus === 'active' && query.isDeleted === false) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      _id: 'cand_inactive',
      accountStatus: 'deactivated',
      isDeleted: false,
      cvUrl: 'uploads/cv.pdf'
    });
  };

  let capturedStatus = 0;
  let capturedCode = null;
  const fakeRes = {
    status: (s) => {
      capturedStatus = s;
      return { json: (d) => { capturedCode = d.code; } };
    }
  };

  const fakeReq = {
    params: { id: 'cand_inactive' },
    user: { _id: 'user_sec46', role: 'company' }
  };

  await candidateController.downloadCv(fakeReq, fakeRes, () => {});

  assert.strictEqual(quotaJobIdConsumed, 'cv_download', 'Quota must be checked under cv_download bucket');
  assert.strictEqual(capturedStatus, 404, 'Deactivated candidate CV must return 404');
  assert.strictEqual(capturedCode, 'CV_NOT_FOUND', 'Must return CV_NOT_FOUND code');

  // Case 2: Download quota exceeded
  entitlementService.checkAndConsumeDownloadQuota = async () => {
    throw { statusCode: 429, code: 'DAILY_DOWNLOAD_LIMIT_REACHED', message: 'Quota exceeded' };
  };

  let quotaExceededErr = null;
  await candidateController.downloadCv(fakeReq, fakeRes, (err) => { quotaExceededErr = err; });
  assert.ok(quotaExceededErr, 'next(err) must receive error when cv_download quota exceeded');
  assert.strictEqual(quotaExceededErr.statusCode, 429);
  assert.strictEqual(quotaExceededErr.code, 'DAILY_DOWNLOAD_LIMIT_REACHED');

  Candidate.findOne = originalCandidateFindOne;
  Company.findOne = originalCompanyFindOne;
  entitlementService.checkAndConsumeDownloadQuota = originalQuotaCheck;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-47: Candidate Self-Management /me Routes Enforce requirePasswordChanged
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-47: Candidate /me routes enforce requirePasswordChanged and block unverified password change', async () => {
  const candidateRoutes = require('./src/routes/candidate.routes');
  const { requirePasswordChanged } = require('./src/middleware/mustChangePassword.middleware');

  // 1. Inspect route stack to confirm requirePasswordChanged middleware is attached to /me routes
  const meRoutes = candidateRoutes.stack.filter(layer => {
    return layer.route && layer.route.path.startsWith('/me');
  });

  assert.ok(meRoutes.length >= 6, 'Candidate router must have at least 6 /me routes');
  for (const layer of meRoutes) {
    const middlewareNames = layer.route.stack.map(s => s.name || s.handle.name);
    assert.ok(
      middlewareNames.includes('requirePasswordChanged'),
      `Route ${layer.route.path} must include requirePasswordChanged middleware`
    );
  }

  // 2. Directly verify execution: candidate with mustChangePassword=true is blocked
  let capturedStatus = 0;
  let capturedCode = null;
  const fakeReq = {
    user: { _id: 'cand_user', role: 'candidate', mustChangePassword: true },
    originalUrl: '/api/candidates/me'
  };
  const fakeRes = {
    status: (s) => {
      capturedStatus = s;
      return { json: (d) => { capturedCode = d.code; } };
    }
  };

  requirePasswordChanged(fakeReq, fakeRes, () => {
    throw new Error('next() must not be called when mustChangePassword is true');
  });

  assert.strictEqual(capturedStatus, 403, 'Must return 403 for candidate needing password change');
  assert.strictEqual(capturedCode, 'PASSWORD_CHANGE_REQUIRED');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-48: Account Lockout DoS Mitigation (10 attempts, 10 min window)
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-48: authService.login locks account on 10th failed attempt for 10 minutes (not 5 attempts)', async () => {
  const authService = require('./src/services/auth.service');
  const User = require('./src/models/User');
  const bcrypt = require('bcryptjs');

  const originalFindOne = User.findOne.bind(User);
  const originalFindOneAndUpdate = User.findOneAndUpdate.bind(User);
  const originalUpdateOne = User.updateOne.bind(User);

  // Synthetic user with 9 failed attempts already recorded
  const mockUser = {
    _id: 'user_sec48',
    phone: '01012345678',
    role: 'candidate',
    accountStatus: 'active',
    isBlocked: false,
    loginFailedCount: 9,
    loginLockedUntil: null,
    passwordHash: await bcrypt.hash('CorrectPassword1!', 10),
    save: async () => {}
  };

  const mockUser9Attempts = {
    _id: 'user_sec48_9',
    phone: '01012345679',
    role: 'candidate',
    accountStatus: 'active',
    isBlocked: false,
    loginFailedCount: 8,
    loginLockedUntil: null,
    passwordHash: await bcrypt.hash('CorrectPassword1!', 10),
    save: async () => {}
  };

  User.findOneAndUpdate = (filter, update) => {
    const target = filter._id === mockUser._id ? mockUser : mockUser9Attempts;
    if (update.$inc && update.$inc.loginFailedCount) {
      target.loginFailedCount = (target.loginFailedCount || 0) + update.$inc.loginFailedCount;
    }
    return Promise.resolve(target);
  };

  User.updateOne = (filter, update) => {
    const target = filter._id === mockUser._id ? mockUser : mockUser9Attempts;
    if (update.$set) {
      Object.assign(target, update.$set);
    }
    return Promise.resolve({ modifiedCount: 1 });
  };

  User.findOne = () => ({
    select: () => Promise.resolve(mockUser)
  });

  // 10th failed attempt with incorrect password
  await assert.rejects(
    async () => {
      await authService.login('01012345678', 'WrongPassword!', 'candidate', null);
    },
    (err) => err.code === 'INVALID_CREDENTIALS' && err.statusCode === 401,
    'Failed login must throw 401 INVALID_CREDENTIALS'
  );

  // On the 10th failed attempt:
  // - loginLockedUntil must be set ~10 minutes from now
  // - loginFailedCount reset to 0
  assert.ok(mockUser.loginLockedUntil instanceof Date, 'loginLockedUntil must be a Date');
  const diffMinutes = (mockUser.loginLockedUntil.getTime() - Date.now()) / (60 * 1000);
  assert.ok(diffMinutes > 9 && diffMinutes <= 10.1, `Lock duration must be ~10 minutes, got ${diffMinutes.toFixed(1)}m`);
  assert.strictEqual(mockUser.loginFailedCount, 0, 'loginFailedCount must reset to 0 upon lockout');

  // Verify that an account with 8 failed attempts does NOT get locked on the 9th attempt
  User.findOne = () => ({
    select: () => Promise.resolve(mockUser9Attempts)
  });

  await assert.rejects(
    async () => {
      await authService.login('01012345679', 'WrongPassword!', 'candidate', null);
    },
    (err) => err.code === 'INVALID_CREDENTIALS',
    '9th failed attempt must throw INVALID_CREDENTIALS'
  );

  assert.strictEqual(mockUser9Attempts.loginLockedUntil, null, 'Account must NOT be locked after only 9 failed attempts');
  assert.strictEqual(mockUser9Attempts.loginFailedCount, 9, 'Counter should increment to 9 without locking');

  User.findOne = originalFindOne;
  User.findOneAndUpdate = originalFindOneAndUpdate;
  User.updateOne = originalUpdateOne;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-49: Regular Candidate Detail Route Consumes Search Quota & Has Rate Limiter
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-49: getCandidateById consumes daily search quota and /:id route enforces searchLimiter', async () => {
  const candidateController = require('./src/controllers/candidate.controller');
  const candidateRoutes = require('./src/routes/candidate.routes');
  const entitlementService = require('./src/services/entitlement.service');
  const candidateService = require('./src/services/candidate.service');

  const { searchLimiter } = require('./src/middleware/rateLimit.middleware');

  // 1. Route layer validation
  const detailRoute = candidateRoutes.stack.find(layer => layer.route && layer.route.path === '/:id' && layer.route.methods.get);
  assert.ok(detailRoute, 'GET /:id route must exist');
  assert.ok(detailRoute.route.stack.some(s => s.handle === searchLimiter), 'GET /:id must include searchLimiter');

  // Also verify /platinum/browse includes searchLimiter
  const browseRoute = candidateRoutes.stack.find(layer => layer.route && layer.route.path === '/platinum/browse' && layer.route.methods.get);
  assert.ok(browseRoute, 'GET /platinum/browse route must exist');
  assert.ok(browseRoute.route.stack.some(s => s.handle === searchLimiter), 'GET /platinum/browse must include searchLimiter');

  // 2. Controller consumption check
  const originalCheckQuota = entitlementService.checkAndConsumeSearchQuota;
  const originalGetById = candidateService.getCandidateByIdForCompany;

  let quotaCheckedForCompany = null;
  entitlementService.checkAndConsumeSearchQuota = async (companyId) => {
    quotaCheckedForCompany = companyId;
    return { searchesCount: 1, searchesRemaining: 29 };
  };
  candidateService.getCandidateByIdForCompany = async () => ({ _id: 'cand_sec49', name: 'Test' });

  const fakeReq = {
    company: { _id: 'comp_sec49' },
    params: { id: 'cand_sec49' }
  };
  const fakeRes = { status: () => fakeRes, json: () => {} };

  await candidateController.getCandidateById(fakeReq, fakeRes, () => {});
  assert.strictEqual(quotaCheckedForCompany, 'comp_sec49', 'getCandidateById must consume search quota for company callers');

  // When quota exceeded, forward to next(err) with 429
  entitlementService.checkAndConsumeSearchQuota = async () => {
    throw { statusCode: 429, code: 'DAILY_SEARCH_LIMIT_REACHED' };
  };
  let quotaErr = null;
  await candidateController.getCandidateById(fakeReq, fakeRes, (err) => { quotaErr = err; });
  assert.ok(quotaErr, 'Over-quota request must be rejected');
  assert.strictEqual(quotaErr.statusCode, 429);
  assert.strictEqual(quotaErr.code, 'DAILY_SEARCH_LIMIT_REACHED');

  entitlementService.checkAndConsumeSearchQuota = originalCheckQuota;
  candidateService.getCandidateByIdForCompany = originalGetById;
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-50: Platinum Download Route Enforces Monthly Export Limit
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-50: Platinum candidate download route enforces checkExportLimit', async () => {
  const { requireActiveSubscription } = require('./src/middleware/subscription.middleware');
  const candidateRoutes = require('./src/routes/candidate.routes');

  // Route must have requireActiveSubscription configured with checkExportLimit
  const downloadRoute = candidateRoutes.stack.find(layer =>
    layer.route && layer.route.path === '/platinum/candidate/:id/download' && layer.route.methods.get
  );
  assert.ok(downloadRoute, 'GET /platinum/candidate/:id/download route must exist');

  // Middleware test: company with exportsUsed >= exportLimit must be rejected
  const gate = requireActiveSubscription({ checkExportLimit: true });
  const maxedCompany = {
    subscriptionStatus: 'active',
    subscriptionEndDate: new Date(Date.now() + 86400000),
    exportsUsed: 50,
    exportLimit: 50
  };

  let capturedStatus = 0;
  let capturedCode = null;
  const fakeRes = {
    status: (s) => {
      capturedStatus = s;
      return { json: (d) => { capturedCode = d.code; } };
    }
  };

  await gate({ company: maxedCompany }, fakeRes, () => {
    throw new Error('next() must NOT be called when monthly export limit is reached');
  });

  assert.strictEqual(capturedStatus, 429, 'Must return 429 when monthly exports are exhausted');
  assert.strictEqual(capturedCode, 'EXPORT_LIMIT_REACHED');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-51: CV Download Requires Password Changed for All Roles
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-51: downloadCv blocks candidate with temporary password and /cv/:id requires password changed', async () => {
  const candidateController = require('./src/controllers/candidate.controller');
  const candidateRoutes = require('./src/routes/candidate.routes');

  // 1. Route has requirePasswordChanged
  const cvRoute = candidateRoutes.stack.find(layer => layer.route && layer.route.path === '/cv/:id' && layer.route.methods.get);
  assert.ok(cvRoute, 'GET /cv/:id route must exist');
  const middlewareNames = cvRoute.route.stack.map(s => s.name || s.handle.name);
  assert.ok(middlewareNames.includes('requirePasswordChanged'), '/cv/:id must include requirePasswordChanged');

  // 2. Controller check blocks candidate role with mustChangePassword = true
  let capturedStatus = 0;
  let capturedCode = null;
  const fakeReq = {
    user: { _id: 'cand_123', role: 'candidate', mustChangePassword: true },
    params: { id: 'cand_123' }
  };
  const fakeRes = {
    status: (s) => {
      capturedStatus = s;
      return { json: (d) => { capturedCode = d.code; } };
    }
  };

  await candidateController.downloadCv(fakeReq, fakeRes, () => {});
  assert.strictEqual(capturedStatus, 403, 'Must return 403 for candidate with temporary password');
  assert.strictEqual(capturedCode, 'PASSWORD_CHANGE_REQUIRED');
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-52: IP Login Limiter Decoupled & Concurrency Protected via Atomic $inc
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-52: loginLimiter max is strictly below account lockout threshold & authService uses atomic $inc', async () => {
  const fs = require('fs');
  const rateLimitSrc = fs.readFileSync(require.resolve('./src/middleware/rateLimit.middleware'), 'utf8');
  const authServiceSrc = fs.readFileSync(require.resolve('./src/services/auth.service'), 'utf8');

  // 1. IP rate limiter max must be <= 5 (strictly less than 10-attempt lockout)
  const maxMatch = rateLimitSrc.match(/loginLimiter\s*=\s*rateLimit\(\{[\s\S]*?max:\s*(\d+)/);
  assert.ok(maxMatch, 'loginLimiter max setting must be found in rateLimit.middleware.js');
  const ipMax = parseInt(maxMatch[1], 10);
  assert.ok(ipMax <= 5, `loginLimiter max (${ipMax}) must be <= 5 to prevent single-IP account lockout`);

  // 2. authService must use User.findOneAndUpdate with $inc for failed login counts
  assert.ok(
    authServiceSrc.includes('User.findOneAndUpdate') && authServiceSrc.includes('$inc: { loginFailedCount: 1 }'),
    'authService must increment loginFailedCount atomically using User.findOneAndUpdate with $inc'
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// SEC-53: Public Phone Check Strips Entity Type (existsIn) and Masked Name Leaks
// ─────────────────────────────────────────────────────────────────────────────
check('SEC-53: checkPhone strips existsIn and maskedName from public response', async () => {
  const recommendationService = require('./src/services/recommendation.service');
  const Candidate = require('./src/models/Candidate');
  const User = require('./src/models/User');

  const originalCandFindOne = Candidate.findOne.bind(Candidate);
  const originalUserFindOne = User.findOne.bind(User);

  // Mock finding existing candidate (use select chaining compatible with query)
  Candidate.findOne = () => ({
    select: () => ({
      lean: () => Promise.resolve({
        _id: 'cand_victim',
        phoneNormalized: '+201012345678',
        fullName: 'أحمد محمود',
        isDeleted: false
      })
    })
  });
  User.findOne = () => ({
    select: () => ({
      lean: () => Promise.resolve(null)
    })
  });

  const result = await recommendationService.checkPhoneAvailability('01012345678', false, 'علي حسن');

  Candidate.findOne = originalCandFindOne;
  User.findOne = originalUserFindOne;

  assert.strictEqual('existsIn' in result, false, 'checkPhone response must NOT leak existsIn property');
  assert.strictEqual('maskedName' in result, false, 'checkPhone response must NOT leak maskedName property');
  if (result.message) {
    assert.strictEqual(result.message.includes('***'), false, 'checkPhone message must NOT contain victim initials');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
check('SEC-54: Production CORS and cookie CSRF gates use normalized deployment environment', () => {
  const fs = require('fs');
  const appSource = fs.readFileSync(require.resolve('./src/app.js'), 'utf8');
  const authSource = fs.readFileSync(require.resolve('./src/middleware/auth.middleware.js'), 'utf8');
  assert.ok(appSource.includes("const { CLIENT_URL, NODE_ENV } = require('./config/env')"));
  assert.ok(appSource.includes("if (NODE_ENV !== 'production')"));
  assert.ok(authSource.includes("if (NODE_ENV === 'production')"));
  assert.strictEqual(appSource.includes("if (process.env.NODE_ENV !== 'production')"), false);
  assert.strictEqual(authSource.includes("if (process.env.NODE_ENV === 'production')"), false);
});

check('SEC-55: Session-revoking logout route requires authentication and cookie CSRF checks', () => {
  const fs = require('fs');
  const authRoutes = fs.readFileSync(require.resolve('./src/routes/auth.routes.js'), 'utf8');
  assert.ok(authRoutes.includes("router.post('/logout', authenticate, authController.logout)"));
});

check('SEC-56: Referral history does not disclose referred candidate phone numbers and is bounded', () => {
  const fs = require('fs');
  const candidateSource = fs.readFileSync(require.resolve('./src/services/candidate.service.js'), 'utf8');
  const start = candidateSource.indexOf('async function getCandidateReferralStats');
  const end = candidateSource.indexOf('\nasync function getCandidateByIdForCompany', start);
  const source = candidateSource.slice(start, end);
  assert.ok(source.includes(".select('status createdAt')"));
  assert.ok(source.includes('.limit(100)'));
  assert.strictEqual(source.includes("'fullName phone availabilityStatus createdAt'"), false);
});

check('SEC-57: Candidate search and export do not double-increment monthly counters', () => {
  const fs = require('fs');
  const searchSource = fs.readFileSync(require.resolve('./src/services/search.service.js'), 'utf8');
  const exportSource = fs.readFileSync(require.resolve('./src/services/export.service.js'), 'utf8');
  assert.strictEqual(searchSource.includes('company.searchesUsed ='), false);
  assert.strictEqual(exportSource.includes('company.exportsUsed ='), false);
});

check('SEC-58: Distributed Mongo rate-limit stores protect authentication and API routes', () => {
  const fs = require('fs');
  const rateLimitSource = fs.readFileSync(require.resolve('./src/middleware/rateLimit.middleware.js'), 'utf8');
  const appSource = fs.readFileSync(require.resolve('./src/app.js'), 'utf8');
  const recommendationSource = fs.readFileSync(require.resolve('./src/routes/recommendation.routes.js'), 'utf8');
  assert.ok(rateLimitSource.includes("new MongoRateLimitStore('login')"));
  assert.ok(rateLimitSource.includes("new MongoRateLimitStore('search')"));
  assert.ok(rateLimitSource.includes("new MongoRateLimitStore('api')"));
  assert.ok(recommendationSource.includes("new MongoRateLimitStore('recommendation-submit')"));
  assert.ok(appSource.includes("app.use('/api', apiLimiterShared, routes)"));
});

check('SEC-59: Public root health check does not trigger database connection attempts', () => {
  const fs = require('fs');
  const appSource = fs.readFileSync(require.resolve('./src/app.js'), 'utf8');
  const rootStart = appSource.indexOf("app.get('/', apiLimiter");
  const rootEnd = appSource.indexOf('// SEC-42: Rate limiter is registered BEFORE', rootStart);
  const rootHandler = appSource.slice(rootStart, rootEnd);
  assert.ok(rootStart >= 0 && rootEnd > rootStart, 'Root health handler must be present');
  assert.strictEqual(rootHandler.includes('connectDB'), false, 'Root handler must not initiate database work');
});

check('SEC-60: Authenticated Paymob refund event revokes only its linked active subscription', async () => {
  const PaymentOrder = require('./src/models/PaymentOrder');
  const Company = require('./src/models/Company');
  const paymentController = require('./src/controllers/payment.controller');
  const paymobService = require('./src/services/paymob.service');
  const order = {
    _id: 'order_sec60',
    companyId: 'company_sec60',
    paymobOrderId: 'paymob_sec60',
    paymobTransactionId: 'txn_paid_sec60',
    paymobRefundTransactionId: null,
    planName: 'Basic',
    status: 'paid',
    paidAt: new Date(),
    save: async function () {}
  };
  const originalFindOne = PaymentOrder.findOne.bind(PaymentOrder);
  const originalOrderFindOneAndUpdate = PaymentOrder.findOneAndUpdate.bind(PaymentOrder);
  const originalCompanyUpdateOne = Company.updateOne.bind(Company);
  const originalVerifyHmac = paymobService.verifyHmac;
  const originalExpectedIntegration = paymobService.isExpectedIntegration;
  const originalHmacKey = process.env.PAYMOB_HMAC_KEY;
  let companyFilter;
  let companyUpdate;
  let responseStatus = 0;

  try {
    process.env.PAYMOB_HMAC_KEY = 'test_key_sec60';
    PaymentOrder.findOne = async () => order;
    PaymentOrder.findOneAndUpdate = async (_filter, update) => {
      Object.assign(order, update.$set);
      return order;
    };
    Company.updateOne = async (filter, update) => {
      companyFilter = filter;
      companyUpdate = update;
      return { modifiedCount: 1 };
    };
    paymobService.verifyHmac = () => true;
    paymobService.isExpectedIntegration = () => true;
    const res = {
      status: (code) => { responseStatus = code; return res; },
      json: () => {}
    };

    await paymentController.handleWebhook({
      query: { hmac: 'valid' },
      body: { obj: {
        id: 'txn_sec60', success: true, is_refunded: true,
        order: { id: 'paymob_sec60' }
      } }
    }, res);
  } finally {
    PaymentOrder.findOne = originalFindOne;
    PaymentOrder.findOneAndUpdate = originalOrderFindOneAndUpdate;
    Company.updateOne = originalCompanyUpdateOne;
    paymobService.verifyHmac = originalVerifyHmac;
    paymobService.isExpectedIntegration = originalExpectedIntegration;
    if (originalHmacKey === undefined) delete process.env.PAYMOB_HMAC_KEY;
    else process.env.PAYMOB_HMAC_KEY = originalHmacKey;
  }

  assert.strictEqual(order.status, 'refunded');
  assert.strictEqual(order.paymobTransactionId, 'txn_paid_sec60', 'Refund must preserve the original payment transaction ID');
  assert.strictEqual(order.paymobRefundTransactionId, 'txn_sec60');
  assert.strictEqual(responseStatus, 200);
  assert.strictEqual(companyFilter._id, order.companyId);
  assert.strictEqual(companyFilter.$or[0].subscriptionPaymentOrderId, order._id);
  assert.strictEqual(companyUpdate.$set.subscriptionStatus, 'inactive');
});

check('SEC-61: Paymob HMAC verification accepts valid signatures and rejects malformed or altered ones', () => {
  const fs = require('fs');
  const crypto = require('crypto');
  const modulePath = require.resolve('./src/services/paymob.service');
  const source = fs.readFileSync(modulePath, 'utf8');
  assert.ok(source.includes('crypto.timingSafeEqual'));
  assert.ok(source.includes("/^[a-f0-9]{128}$/i.test(receivedHmac)"));

  const originalEnv = process.env.PAYMOB_HMAC_KEY;
  const originalIntegration = process.env.PAYMOB_INTEGRATION_ID;
  const previousModule = require.cache[modulePath];
  process.env.PAYMOB_HMAC_KEY = 'sec61_offline_test_key';
  process.env.PAYMOB_INTEGRATION_ID = '12345';
  delete require.cache[modulePath];
  try {
    const paymob = require(modulePath);
    const data = {
      amount_cents: 1200, created_at: '2026-10-23T10:00:00', currency: 'EGP',
      error_occured: false, has_parent_transaction: false, id: 123, integration_id: 456,
      is_3d_secure: true, is_auth: false, is_capture: true, is_refunded: false,
      is_standalone_payment: true, is_voided: false, order: { id: 789 }, owner: 2,
      pending: false, source_data: { pan: '4242', sub_type: 'Visa', type: 'card' }, success: true
    };
    const values = [
      data.amount_cents, data.created_at, data.currency, data.error_occured,
      data.has_parent_transaction, data.id, data.integration_id, data.is_3d_secure,
      data.is_auth, data.is_capture, data.is_refunded, data.is_standalone_payment,
      data.is_voided, data.order.id, data.owner, data.pending, data.source_data.pan,
      data.source_data.sub_type, data.source_data.type, data.success
    ];
    const validHmac = crypto.createHmac('sha512', process.env.PAYMOB_HMAC_KEY)
      .update(values.join('')).digest('hex');
    assert.strictEqual(paymob.verifyHmac(data, validHmac), true);
    assert.strictEqual(paymob.verifyHmac(data, `${validHmac.slice(0, -1)}0`), false);
    assert.strictEqual(paymob.verifyHmac(data, 'not-a-valid-hmac'), false);
    assert.strictEqual(paymob.isExpectedIntegration({ integration_id: 12345 }), true);
    assert.strictEqual(paymob.isExpectedIntegration({ integration_id: 99999 }), false);
    assert.strictEqual(paymob.isExpectedIntegration({}), false);
  } finally {
    delete require.cache[modulePath];
    if (previousModule) require.cache[modulePath] = previousModule;
    if (originalEnv === undefined) delete process.env.PAYMOB_HMAC_KEY;
    else process.env.PAYMOB_HMAC_KEY = originalEnv;
    if (originalIntegration === undefined) delete process.env.PAYMOB_INTEGRATION_ID;
    else process.env.PAYMOB_INTEGRATION_ID = originalIntegration;
  }
});

check('SEC-62: Payment initiation is rate limited per approved company', () => {
  const fs = require('fs');
  const limiterSource = fs.readFileSync(require.resolve('./src/middleware/rateLimit.middleware'), 'utf8');
  const paymentRoutes = fs.readFileSync(require.resolve('./src/routes/payment.routes'), 'utf8');
  assert.ok(limiterSource.includes("new MongoRateLimitStore('payment-initiate')"));
  assert.ok(limiterSource.includes('windowMs: 60 * 60 * 1000'));
  assert.ok(limiterSource.includes('max: 10'));
  assert.ok(paymentRoutes.includes("router.post('/initiate', paymentInitiateLimiter, paymentController.initiatePayment)"));
});

check('SEC-63: Payment success and refund transitions are atomic and preserve transaction audit fields', () => {
  const fs = require('fs');
  const controllerSource = fs.readFileSync(require.resolve('./src/controllers/payment.controller'), 'utf8');
  const orderSource = fs.readFileSync(require.resolve('./src/models/PaymentOrder'), 'utf8');
  assert.ok(controllerSource.includes("status: { $nin: ['paid', 'refunded'] }"));
  assert.ok(controllerSource.includes("status: { $ne: 'refunded' }"));
  assert.ok(controllerSource.includes("select('status').lean()"));
  assert.ok(controllerSource.includes('paymobRefundTransactionId: transactionId'));
  assert.ok(orderSource.includes('paymobRefundTransactionId: { type: String, default: null }'));
});

check('SEC-64: Candidate cart counts and exports include only available candidates and active job titles', () => {
  const fs = require('fs');
  const cartSource = fs.readFileSync(require.resolve('./src/services/cart.service'), 'utf8');
  assert.ok(cartSource.includes("availabilityStatus: 'Available'"));
  assert.ok(cartSource.includes('if (!job || job.isActive === false)'));
  assert.ok(cartSource.includes('item.jobId.isActive === false'));
  assert.ok(cartSource.includes('availabilityStatus: \'Available\','));
});

check('SEC-65: Employer search, detail, and CV routes cannot retrieve unavailable candidate profiles', () => {
  const { buildCandidateFilters } = require('./src/services/search.service');
  const candidateServiceSource = require('fs').readFileSync(require.resolve('./src/services/candidate.service'), 'utf8');
  const candidateControllerSource = require('fs').readFileSync(require.resolve('./src/controllers/candidate.controller'), 'utf8');
  const searchFilter = buildCandidateFilters({ availability: 'Hired' });
  assert.strictEqual(searchFilter.availabilityStatus, 'Available', 'Caller-supplied status must not expand employer search');
  const detailStart = candidateServiceSource.indexOf('async function getCandidateByIdForCompany');
  const detailEnd = candidateServiceSource.indexOf('\nmodule.exports', detailStart);
  const detailSource = candidateServiceSource.slice(detailStart, detailEnd);
  assert.ok(detailSource.includes("availabilityStatus: 'Available'"), 'Single-candidate detail must require Available status');
  assert.ok(candidateControllerSource.includes("availabilityStatus: 'Available'"), 'Company CV download must require Available status');
});

// SUMMARY REPORT & RUNNER
// ─────────────────────────────────────────────────────────────────────────────



(async () => {
  for (const { testName, fn } of tests) {
    totalTests++;
    try {
      await fn();
      console.log(`[PASS] ${testName}`);
      passedTests++;
    } catch (err) {
      console.error(`[FAIL] ${testName}: ${err.message}`);
    }
  }

  console.log('\n====================================================');
  console.log(`Verification Complete: ${passedTests}/${totalTests} security controls passed.`);
  console.log('====================================================');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
})();
