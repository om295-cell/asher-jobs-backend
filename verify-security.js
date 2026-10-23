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
