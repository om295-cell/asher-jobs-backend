const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Candidate = require('../models/Candidate');
const Company = require('../models/Company');
const Job = require('../models/Job');
const Referral = require('../models/Referral');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/env');
const { normalizeEgyptianPhone } = require('../utils/phoneNormalizer');
const { logActivity } = require('./activity.service');

function generateToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      email: user.email,
      phone: user.phoneNormalized
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'ASH-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function registerCandidate(data, req) {
  const {
    fullName,
    phone,
    email,
    desiredJobId,
    password,
    passwordConfirm,
    governorate,
    area,
    yearsOfExperience,
    qualification,
    skills,
    consentGiven,
    refCode
  } = data;

  if (!fullName || !fullName.trim()) {
    throw { statusCode: 400, message: 'Full name is required.', code: 'NAME_REQUIRED' };
  }

  if (!phone) {
    throw { statusCode: 400, message: 'Phone number is required.', code: 'PHONE_REQUIRED' };
  }

  // Egyptian phone normalization
  const phoneCheck = normalizeEgyptianPhone(phone);
  if (!phoneCheck.isValid) {
    throw { statusCode: 400, message: phoneCheck.error, code: 'INVALID_PHONE' };
  }

  if (!desiredJobId) {
    throw { statusCode: 400, message: 'Please select a desired job title from the list.', code: 'JOB_REQUIRED' };
  }

  // Verify job exists and is active
  const job = await Job.findById(desiredJobId);
  if (!job || !job.isActive) {
    throw { statusCode: 400, message: 'Selected job title is invalid or no longer active.', code: 'INVALID_JOB' };
  }

  // Mandatory consent check
  if (!consentGiven) {
    throw {
      statusCode: 400,
      message: 'You must consent to allowing Asher Jobs to use your data for recruitment purposes.',
      code: 'CONSENT_REQUIRED'
    };
  }

  if (!password || password.length < 6) {
    throw { statusCode: 400, message: 'Password must be at least 6 characters.', code: 'INVALID_PASSWORD' };
  }

  if (passwordConfirm && password !== passwordConfirm) {
    throw { statusCode: 400, message: 'Passwords do not match.', code: 'PASSWORDS_MISMATCH' };
  }

  // Duplicate candidate prevention by normalized phone number
  const existingCandidate = await Candidate.findOne({ phoneNormalized: phoneCheck.normalized, isDeleted: false });
  if (existingCandidate) {
    throw {
      statusCode: 409,
      message: 'A candidate profile with this mobile number already exists. Please log in or update your existing profile.',
      code: 'DUPLICATE_PHONE'
    };
  }

  // Check user by normalized phone or email
  let existingUser = await User.findOne({ phoneNormalized: phoneCheck.normalized });
  if (existingUser) {
    throw {
      statusCode: 409,
      message: 'An account with this phone number already exists. Please log in.',
      code: 'DUPLICATE_USER'
    };
  }

  if (email && email.trim()) {
    const existingEmailUser = await User.findOne({ email: email.trim().toLowerCase() });
    if (existingEmailUser) {
      throw { statusCode: 409, message: 'An account with this email already exists.', code: 'DUPLICATE_EMAIL' };
    }
  }

  // Handle referral invitation if refCode provided
  let invitedByCandidate = null;
  if (refCode) {
    const referrer = await Candidate.findOne({ referralCode: refCode.trim().toUpperCase() });
    if (referrer) {
      invitedByCandidate = referrer;
    }
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  // Create User
  const user = await User.create({
    email: email && email.trim() ? email.trim().toLowerCase() : undefined,
    phone: phoneCheck.local,
    phoneNormalized: phoneCheck.normalized,
    passwordHash,
    role: 'candidate',
    accountStatus: 'active'
  });

  // Generate unique referral code for this new candidate
  let myReferralCode = generateReferralCode();
  let codeUnique = false;
  while (!codeUnique) {
    const checkCode = await Candidate.findOne({ referralCode: myReferralCode });
    if (!checkCode) codeUnique = true;
    else myReferralCode = generateReferralCode();
  }

  // Format skills array
  let skillsArray = [];
  if (Array.isArray(skills)) {
    skillsArray = skills;
  } else if (typeof skills === 'string') {
    skillsArray = skills.split(',').map((s) => s.trim()).filter(Boolean);
  }

  // Create Candidate
  const candidate = await Candidate.create({
    userId: user._id,
    fullName: fullName.trim(),
    phone: phoneCheck.local,
    phoneNormalized: phoneCheck.normalized,
    email: email && email.trim() ? email.trim().toLowerCase() : '',
    desiredJobId: job._id,
    categoryId: job.categoryId,
    governorate: governorate || 'Sharqia',
    area: area || '10th of Ramadan',
    yearsOfExperience: Number(yearsOfExperience) || 0,
    qualification: qualification || 'Technical Diploma',
    skills: skillsArray,
    availabilityStatus: 'Available',
    consentGiven: true,
    consentDate: new Date(),
    consentVersion: '1.0',
    referralCode: myReferralCode,
    invitedBy: invitedByCandidate ? invitedByCandidate._id : null
  });

  // Record referral tracking if applicable
  if (invitedByCandidate) {
    await Referral.create({
      referrerCandidateId: invitedByCandidate._id,
      referredCandidateId: candidate._id,
      referralCode: refCode.trim().toUpperCase(),
      status: 'Registered'
    });
    await Candidate.findByIdAndUpdate(invitedByCandidate._id, { $inc: { referralCount: 1 } });
  }

  const token = generateToken(user);

  await logActivity({
    actorId: user._id,
    actorRole: 'candidate',
    action: 'CANDIDATE_REGISTERED',
    entityType: 'Candidate',
    entityId: candidate._id,
    metadata: { job: job.name, phone: phoneCheck.normalized },
    req
  });

  return {
    user: {
      id: user._id,
      email: user.email,
      phone: user.phone,
      role: user.role
    },
    candidate,
    token
  };
}

async function registerCompany(data, req) {
  const {
    companyName,
    email,
    phone,
    password,
    passwordConfirm,
    address,
    governorate,
    area,
    industry,
    website,
    contactPerson,
    contactPersonPhone
  } = data;

  if (!companyName || !companyName.trim()) {
    throw { statusCode: 400, message: 'Company name is required.', code: 'COMPANY_NAME_REQUIRED' };
  }

  if (!email || !email.trim()) {
    throw { statusCode: 400, message: 'Company email is required.', code: 'EMAIL_REQUIRED' };
  }

  if (!phone) {
    throw { statusCode: 400, message: 'Contact phone is required.', code: 'PHONE_REQUIRED' };
  }

  if (!password || password.length < 6) {
    throw { statusCode: 400, message: 'Password must be at least 6 characters.', code: 'INVALID_PASSWORD' };
  }

  if (passwordConfirm && password !== passwordConfirm) {
    throw { statusCode: 400, message: 'Passwords do not match.', code: 'PASSWORDS_MISMATCH' };
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existingEmail = await User.findOne({ email: normalizedEmail });
  if (existingEmail) {
    throw { statusCode: 409, message: 'An account with this email address already exists.', code: 'DUPLICATE_EMAIL' };
  }

  const phoneCheck = normalizeEgyptianPhone(phone);
  const phoneNormalized = phoneCheck.isValid ? phoneCheck.normalized : phone;

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const user = await User.create({
    email: normalizedEmail,
    phone: phoneCheck.isValid ? phoneCheck.local : phone,
    phoneNormalized,
    passwordHash,
    role: 'company',
    accountStatus: 'pending'
  });

  const company = await Company.create({
    userId: user._id,
    companyName: companyName.trim(),
    email: normalizedEmail,
    phone: phoneCheck.isValid ? phoneCheck.local : phone,
    phoneNormalized,
    address: address || '',
    governorate: governorate || 'Sharqia',
    area: area || '10th of Ramadan',
    industry: industry || 'Manufacturing & Industrial',
    website: website || '',
    contactPerson: contactPerson || '',
    contactPersonPhone: contactPersonPhone || '',
    verificationStatus: 'Pending', // pending review
    subscriptionStatus: 'active',
    subscriptionPlan: 'Basic',
    monthlyPriceEgp: 50
  });

  const token = generateToken(user);

  await logActivity({
    actorId: user._id,
    actorRole: 'company',
    action: 'COMPANY_REGISTERED',
    entityType: 'Company',
    entityId: company._id,
    metadata: { companyName: company.companyName, email: normalizedEmail },
    req
  });

  return {
    user: {
      id: user._id,
      email: user.email,
      phone: user.phone,
      role: user.role
    },
    company,
    token
  };
}

async function login(credential, password, req) {
  if (!credential || !password) {
    throw { statusCode: 400, message: 'Email or phone and password are required.', code: 'CREDENTIALS_REQUIRED' };
  }

  const trimmed = credential.trim();
  let user = null;

  if (trimmed.includes('@')) {
    user = await User.findOne({ email: trimmed.toLowerCase() }).select('+passwordHash');
  } else {
    const phoneCheck = normalizeEgyptianPhone(trimmed);
    const normalized = phoneCheck.isValid ? phoneCheck.normalized : trimmed;
    user = await User.findOne({
      $or: [{ phoneNormalized: normalized }, { phone: trimmed }]
    }).select('+passwordHash');
  }

  if (!user) {
    throw { statusCode: 401, message: 'Invalid credentials. Please verify and try again.', code: 'INVALID_CREDENTIALS' };
  }

  if (user.isBlocked) {
    throw {
      statusCode: 403,
      message: user.blockReason ? `Account blocked: ${user.blockReason}` : 'Your account has been blocked by administrators.',
      code: 'ACCOUNT_BLOCKED'
    };
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw { statusCode: 401, message: 'Invalid credentials. Please verify and try again.', code: 'INVALID_CREDENTIALS' };
  }

  // Update last login
  user.lastLoginAt = new Date();
  await user.save();

  const token = generateToken(user);

  // Fetch role-specific profile
  let profile = null;
  if (user.role === 'candidate') {
    profile = await Candidate.findOne({ userId: user._id })
      .populate('desiredJobId', 'name nameAr')
      .populate('categoryId', 'name nameAr');
  } else if (user.role === 'company') {
    profile = await Company.findOne({ userId: user._id });
  }

  await logActivity({
    actorId: user._id,
    actorRole: user.role,
    action: 'LOGIN',
    entityType: 'User',
    entityId: user._id,
    metadata: { role: user.role },
    req
  });

  return {
    user: {
      id: user._id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      accountStatus: user.accountStatus
    },
    profile,
    token
  };
}

async function getMe(userId) {
  const user = await User.findById(userId);
  if (!user) {
    throw { statusCode: 404, message: 'User not found.', code: 'USER_NOT_FOUND' };
  }

  let profile = null;
  if (user.role === 'candidate') {
    profile = await Candidate.findOne({ userId: user._id, isDeleted: false })
      .populate('desiredJobId', 'name nameAr')
      .populate('categoryId', 'name nameAr');
  } else if (user.role === 'company') {
    profile = await Company.findOne({ userId: user._id, isDeleted: false });
  }

  return {
    user: {
      id: user._id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      accountStatus: user.accountStatus,
      isBlocked: user.isBlocked
    },
    profile
  };
}

async function updatePassword(userId, currentPassword, newPassword) {
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    throw { statusCode: 400, message: 'New password must be at least 6 characters.', code: 'INVALID_PASSWORD' };
  }

  const user = await User.findById(userId).select('+passwordHash');
  if (!user) {
    throw { statusCode: 404, message: 'User not found.', code: 'USER_NOT_FOUND' };
  }

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) {
    throw { statusCode: 400, message: 'Current password is incorrect.', code: 'INCORRECT_PASSWORD' };
  }

  const salt = await bcrypt.genSalt(10);
  user.passwordHash = await bcrypt.hash(newPassword, salt);
  await user.save();

  return { success: true };
}

module.exports = {
  registerCandidate,
  registerCompany,
  login,
  getMe,
  updatePassword,
  generateToken
};
