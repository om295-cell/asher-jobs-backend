const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Company = require('../models/Company');
const Subscription = require('../models/Subscription');
const ActivityLog = require('../models/ActivityLog');
const DailyQuotaUsage = require('../models/DailyQuotaUsage');
const CandidateInteraction = require('../models/CandidateInteraction');
const { logActivity } = require('./activity.service');
const { getPlanLimits, getCairoDateString } = require('./entitlement.service');
const { escapeRegex } = require('../middleware/sanitize.middleware');

/**
 * Super Admin creates a Verified Employer Account (Types A, B, C1, C2)
 */
async function createEmployerAccount(data, adminUser, req = null) {
  const {
    accountType = 'company', // 'company' or 'individual_hr'
    verificationMethod = 'manual', // 'manual' or 'verified_by_company'
    companyName,
    contactPerson,
    email,
    tempPassword,
    verifiedByCompanyId = null,
    subscriptionPlan = 'Basic',
    subscriptionPriceEgp,
    subscriptionDurationDays = 30,
    paymentMethod = 'cash', // 'online' | 'cash' | 'free'
    subscriptionStatus = 'active',
    phone = '01000000000',
    governorate = 'Sharqia',
    area = '10th of Ramadan'
  } = data;

  if (!email || !email.trim()) {
    throw { statusCode: 400, message: 'البريد الإلكتروني مطلوب لإنشاء الحساب.', code: 'EMAIL_REQUIRED' };
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (accountType === 'company' && (!companyName || !companyName.trim())) {
    throw { statusCode: 400, message: 'اسم الشركة مطلوب.', code: 'COMPANY_NAME_REQUIRED' };
  }

  if (!contactPerson || !contactPerson.trim()) {
    throw {
      statusCode: 400,
      message: accountType === 'individual_hr' ? 'اسم مسؤول الموارد البشرية (HR) مطلوب.' : 'اسم الشخص المفوض مطلوب.',
      code: 'CONTACT_PERSON_REQUIRED'
    };
  }

  // Check unique email
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw { statusCode: 409, message: 'البريد الإلكتروني مسجل بالفعل لمستخدم آخر.', code: 'DUPLICATE_EMAIL' };
  }

  let finalVerifiedByCompanyId = null;

  // Verification Rules for Types C1 & C2
  if (verificationMethod === 'verified_by_company') {
    if (!verifiedByCompanyId) {
      throw {
        statusCode: 400,
        message: 'يرجى اختيار الشركة الموثقة التي قامت بالتوثيق.',
        code: 'VERIFIER_COMPANY_REQUIRED'
      };
    }

    const verifyingCompany = await Company.findById(verifiedByCompanyId);
    if (!verifyingCompany || verifyingCompany.isDeleted || verifyingCompany.isBlocked) {
      throw { statusCode: 404, message: 'الشركة الموثقة المحددة غير موجودة أو معطلة.', code: 'VERIFIER_NOT_FOUND' };
    }

    // Critical rule: ONLY manually verified companies are eligible to verify other accounts!
    if (verifyingCompany.verificationMethod !== 'manual') {
      throw {
        statusCode: 400,
        message: 'غير مسموح: الشركات التي تم توثيقها من قبل شركة أخرى لا يحق لها توثيق أي حسابات.',
        code: 'INELIGIBLE_VERIFIER'
      };
    }

    if (verifyingCompany.verificationStatus !== 'Approved' || verifyingCompany.accountStatus !== 'active') {
      throw {
        statusCode: 400,
        message: 'الشركة الموثقة المحددة غير نشطة أو غير معتمدة.',
        code: 'VERIFIER_NOT_ACTIVE'
      };
    }

    finalVerifiedByCompanyId = verifyingCompany._id;
  }

  // Fetch plan pricing default if not provided
  let planPrice = Number(subscriptionPriceEgp);
  if (isNaN(planPrice) || planPrice < 0) {
    const planObj = await Subscription.findOne({ planName: subscriptionPlan, isActive: true }).lean();
    planPrice = planObj?.priceEgp ?? (subscriptionPlan === 'Platinum' ? 2000 : subscriptionPlan === 'Gold' ? 1000 : 500);
  }

  const DEFAULT_TEMP_PASSWORD = 'Temp@1234';
  const actualTempPassword = (tempPassword && tempPassword.trim()) ? tempPassword.trim() : DEFAULT_TEMP_PASSWORD;

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(actualTempPassword, salt);

  // Create User document
  const user = await User.create({
    email: normalizedEmail,
    passwordHash,
    role: 'company',
    accountType,
    accountStatus: 'active',
    mustChangePassword: true
  });

  const resolvedCompanyName = companyName && companyName.trim()
    ? companyName.trim()
    : (accountType === 'individual_hr' ? contactPerson.trim() : `HR - ${contactPerson.trim()}`);

  // Create Company document
  const company = await Company.create({
    userId: user._id,
    companyName: resolvedCompanyName,
    contactPerson: contactPerson.trim(),
    email: normalizedEmail,
    phone: phone.trim(),
    governorate,
    area,
    accountType,
    verificationMethod,
    verificationStatus: 'Approved',
    verifiedByCompanyId: finalVerifiedByCompanyId,
    verifiedAt: new Date(),
    accountStatus: 'active',
    mustChangePassword: true,
    createdByAdmin: adminUser ? adminUser._id : null,
    subscriptionPlan,
    subscriptionPriceEgp: planPrice,
    monthlyPriceEgp: planPrice,
    paymentMethod,
    subscriptionStatus,
    subscriptionStartDate: new Date(),
    subscriptionEndDate: new Date(Date.now() + Number(subscriptionDurationDays) * 24 * 60 * 60 * 1000)
  });

  if (adminUser) {
    await logActivity({
      actorId: adminUser._id,
      actorRole: 'admin',
      companyId: company._id,
      action: 'ADMIN_CREATED_EMPLOYER_ACCOUNT',
      entityType: 'Company',
      entityId: company._id,
      metadata: {
        accountType,
        verificationMethod,
        verifiedByCompanyId: finalVerifiedByCompanyId,
        subscriptionPlan,
        planPrice,
        paymentMethod,
        subscriptionDurationDays
      },
      req
    }).catch(() => {});
  }

  return {
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      accountType: user.accountType,
      mustChangePassword: user.mustChangePassword
    },
    company,
    tempPassword: actualTempPassword
  };
}

/**
 * Returns only companies eligible to verify other accounts (manual verification only)
 */
async function getEligibleVerifyingCompanies() {
  return Company.find({
    verificationMethod: 'manual',
    verificationStatus: 'Approved',
    accountStatus: 'active',
    isBlocked: false,
    isDeleted: false
  })
    .select('_id companyName contactPerson email')
    .sort({ companyName: 1 })
    .lean();
}

/**
 * Super Admin resets an account password to a generated temporary password
 */
async function resetPasswordByAdmin(companyId, adminUser, req = null) {
  const company = await Company.findById(companyId);
  if (!company || company.isDeleted) {
    throw { statusCode: 404, message: 'Account not found.', code: 'COMPANY_NOT_FOUND' };
  }

  const user = await User.findById(company.userId).select('+tokenVersion');
  if (!user) {
    throw { statusCode: 404, message: 'User record not found.', code: 'USER_NOT_FOUND' };
  }

  const generatedPassword = 'Temp@1234';
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(generatedPassword, salt);

  user.passwordHash = passwordHash;
  user.mustChangePassword = true;
  user.tokenVersion = (user.tokenVersion || 0) + 1;  // SEC-22: invalidate pre-change tokens
  user.loginFailedCount = 0;       // clear any failed-attempt counter
  user.loginLockedUntil = null;    // unlock account if it was locked out
  await user.save();

  company.mustChangePassword = true;
  await company.save();

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    companyId: company._id,
    action: 'ADMIN_RESET_PASSWORD',
    entityType: 'User',
    entityId: user._id,
    metadata: { companyId: company._id, resetTo: '[RANDOM_TEMP_PASSWORD]' },
    req
  }).catch(() => {});

  return {
    success: true,
    tempPassword: generatedPassword,
    message: `تم إعادة تعيين كلمة المرور إلى (${generatedPassword}) بنجاح وإلزام المستخدم بتغييرها فور الدخول.`
  };
}

/**
 * User changes their temporary password on first login (no current password required)
 */
async function changeInitialPassword(userId, newPassword, req = null) {
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    throw {
      statusCode: 400,
      message: 'New password must be at least 8 characters long.',
      code: 'INVALID_NEW_PASSWORD'
    };
  }

  const user = await User.findById(userId).select('+passwordHash +tokenVersion');
  if (!user) {
    throw { statusCode: 404, message: 'User not found.', code: 'USER_NOT_FOUND' };
  }

  if (!user.mustChangePassword) {
    throw { statusCode: 403, message: 'غير مصرح: الحساب لا يحتاج لتغيير كلمة المرور.', code: 'NOT_REQUIRED' };
  }

  const salt = await bcrypt.genSalt(10);
  user.passwordHash = await bcrypt.hash(newPassword, salt);
  user.mustChangePassword = false;
  user.tokenVersion = (user.tokenVersion || 0) + 1;  // SEC-22: invalidate pre-change tokens
  await user.save();

  await Company.updateOne({ userId: user._id }, { $set: { mustChangePassword: false } });

  await logActivity({
    actorId: user._id,
    actorRole: user.role,
    action: 'INITIAL_PASSWORD_CHANGED',
    entityType: 'User',
    entityId: user._id,
    metadata: { completed: true },
    req
  }).catch(() => {});

  return { success: true, message: 'تم تحديث كلمة المرور بنجاح. يمكنك الآن استخدام كافة مميزات المنصة.' };
}

/**
 * Super Admin changes account operational status (active, on_hold, suspended, banned, removed)
 */
async function updateAccountStatus(companyId, status, reason = '', adminUser, req = null) {
  const company = await Company.findById(companyId);
  if (!company) {
    throw { statusCode: 404, message: 'Company not found.', code: 'COMPANY_NOT_FOUND' };
  }

  const validStatuses = ['active', 'on_hold', 'suspended', 'banned', 'removed'];
  if (!validStatuses.includes(status)) {
    throw { statusCode: 400, message: 'الحالة المحددة غير صحيحة.', code: 'INVALID_STATUS' };
  }

  company.accountStatus = status;

  if (status === 'banned') {
    company.isBlocked = true;
    company.blockReason = reason || 'حظر إداري';
    await User.updateOne({ _id: company.userId }, { $set: { isBlocked: true, blockReason: company.blockReason } });
  } else if (status === 'active') {
    company.isBlocked = false;
    company.blockReason = '';
    company.isDeleted = false;
    await User.updateOne({ _id: company.userId }, { $set: { isBlocked: false, blockReason: '', accountStatus: 'active' } });
  } else if (status === 'removed') {
    company.isDeleted = true;
    company.deletedAt = new Date();
    await User.updateOne({ _id: company.userId }, { $set: { accountStatus: 'deactivated' } });
  } else {
    // on_hold / suspended
    company.isBlocked = false;
    await User.updateOne({ _id: company.userId }, { $set: { accountStatus: status } });
  }

  await company.save();

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    companyId: company._id,
    action: `ADMIN_STATUS_UPDATE_${status.toUpperCase()}`,
    entityType: 'Company',
    entityId: company._id,
    metadata: { newStatus: status, reason },
    req
  }).catch(() => {});

  return company;
}

/**
 * Super Admin updates company subscription plan and pricing
 * paymentMethod: 'online' | 'cash' | 'free'
 */
async function updateSubscriptionPlan(companyId, { plan, priceEgp, durationDays = 30, status = 'active', paymentMethod = 'cash', notes = '' }, adminUser, req = null) {
  const company = await Company.findById(companyId);
  if (!company || company.isDeleted) {
    throw { statusCode: 404, message: 'Company not found.', code: 'COMPANY_NOT_FOUND' };
  }

  const validPlans = ['Basic', 'Gold', 'Platinum', 'Custom'];
  if (!validPlans.includes(plan)) {
    throw { statusCode: 400, message: 'خطة الاشتراك غير صحيحة.', code: 'INVALID_PLAN' };
  }

  company.subscriptionPlan = plan;
  company.subscriptionPriceEgp = Number(priceEgp) || 0;
  company.monthlyPriceEgp = company.subscriptionPriceEgp;
  company.subscriptionStatus = status;
  company.paymentMethod = paymentMethod;
  company.subscriptionStartDate = new Date();
  company.subscriptionEndDate = new Date(Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000);

  await company.save();

  await logActivity({
    actorId: adminUser._id,
    actorRole: 'admin',
    companyId: company._id,
    action: 'ADMIN_SUBSCRIPTION_UPDATE',
    entityType: 'Company',
    entityId: company._id,
    metadata: { plan, priceEgp, durationDays, status, paymentMethod, notes },
    req
  }).catch(() => {});

  return company;
}

/**
 * Super Admin list employer accounts with metrics, filtering, and activity scoring
 */
async function listEmployerAccounts(queryParams = {}) {
  const {
    page = 1,
    limit = 15,
    keyword = '',
    accountType = '',
    verificationMethod = '',
    verificationStatus = '',
    subscriptionPlan = '',
    accountStatus = '',
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = queryParams;

  const filter = { isDeleted: false };

  if (accountType) filter.accountType = accountType;
  if (verificationMethod) filter.verificationMethod = verificationMethod;
  if (verificationStatus) filter.verificationStatus = verificationStatus;
  if (subscriptionPlan) filter.subscriptionPlan = subscriptionPlan;
  if (accountStatus) filter.accountStatus = accountStatus;

  if (keyword && keyword.trim()) {
    const kw = keyword.trim();
    const regex = new RegExp(escapeRegex(kw), 'i');
    filter.$or = [
      { companyName: regex },
      { contactPerson: regex },
      { email: regex },
      { phone: regex }
    ];
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const sortOptions = {};
  sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

  const [companies, total] = await Promise.all([
    Company.find(filter)
      .populate('verifiedByCompanyId', 'companyName email contactPerson')
      .populate('userId', 'lastLoginAt mustChangePassword')
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Company.countDocuments(filter)
  ]);

  // Aggregate metrics for these companies
  const companyIds = companies.map((c) => c._id);

  // Fetch interactions (contacts) count
  const interactionsAgg = await CandidateInteraction.aggregate([
    { $match: { companyId: { $in: companyIds } } },
    { $group: { _id: '$companyId', totalContacts: { $sum: 1 } } }
  ]);
  const contactsMap = new Map();
  interactionsAgg.forEach((item) => contactsMap.set(String(item._id), item.totalContacts));

  // Compute enriched account list
  const enriched = companies.map((c) => {
    const searches = c.searchesUsed || 0;
    const views = c.viewsUsed || 0;
    const downloads = c.exportsUsed || 0;
    const contacts = contactsMap.get(String(c._id)) || 0;

    // Activity score formula: (searches * 1) + (views * 2) + (downloads * 5) + (contacts * 3)
    const activityScore = searches * 1 + views * 2 + downloads * 5 + contacts * 3;

    return {
      ...c,
      metrics: {
        searches,
        views,
        downloads,
        contacts,
        activityScore
      }
    };
  });

  return {
    accounts: enriched,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1
    }
  };
}

/**
 * Computes individual account analytics summary
 */
async function getAccountAnalytics(companyId) {
  const company = await Company.findById(companyId)
    .populate('verifiedByCompanyId', 'companyName email contactPerson')
    .populate('userId', 'lastLoginAt createdAt')
    .lean();

  if (!company) {
    throw { statusCode: 404, message: 'Account not found', code: 'ACCOUNT_NOT_FOUND' };
  }

  const [recentLogs, dailyUsages, totalContacts] = await Promise.all([
    ActivityLog.find({ companyId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    DailyQuotaUsage.find({ companyId })
      .sort({ cairoDate: -1 })
      .limit(30)
      .lean(),
    CandidateInteraction.countDocuments({ companyId })
  ]);

  const searches = company.searchesUsed || 0;
  const views = company.viewsUsed || 0;
  const downloads = company.exportsUsed || 0;
  const activityScore = searches * 1 + views * 2 + downloads * 5 + totalContacts * 3;

  return {
    account: company,
    metrics: {
      searches,
      views,
      downloads,
      contacts: totalContacts,
      activityScore,
      activeDays: dailyUsages.length
    },
    dailyHistory: dailyUsages,
    recentActivity: recentLogs
  };
}

/**
 * Activity ranking: sorts all accounts by activity metrics
 */
async function getActivityRankings({ metric = 'activityScore', limit = 20 }) {
  const companies = await Company.find({ isDeleted: false })
    .select('_id companyName contactPerson email subscriptionPlan searchesUsed exportsUsed viewsUsed accountStatus')
    .lean();

  const companyIds = companies.map((c) => c._id);
  const interactionsAgg = await CandidateInteraction.aggregate([
    { $match: { companyId: { $in: companyIds } } },
    { $group: { _id: '$companyId', totalContacts: { $sum: 1 } } }
  ]);
  const contactsMap = new Map();
  interactionsAgg.forEach((item) => contactsMap.set(String(item._id), item.totalContacts));

  const ranked = companies.map((c) => {
    const searches = c.searchesUsed || 0;
    const views = c.viewsUsed || 0;
    const downloads = c.exportsUsed || 0;
    const contacts = contactsMap.get(String(c._id)) || 0;
    const activityScore = searches * 1 + views * 2 + downloads * 5 + contacts * 3;

    return {
      id: c._id,
      companyName: c.companyName,
      contactPerson: c.contactPerson,
      email: c.email,
      subscriptionPlan: c.subscriptionPlan,
      accountStatus: c.accountStatus,
      searches,
      views,
      downloads,
      contacts,
      activityScore
    };
  });

  ranked.sort((a, b) => {
    if (metric === 'searches') return b.searches - a.searches;
    if (metric === 'downloads') return b.downloads - a.downloads;
    if (metric === 'views') return b.views - a.views;
    if (metric === 'contacts') return b.contacts - a.contacts;
    return b.activityScore - a.activityScore;
  });

  return ranked.slice(0, parseInt(limit, 10) || 20);
}

/**
 * Returns platform-wide aggregate bulk employer analytics
 */
async function getBulkEmployerAnalytics() {
  const [statusCounts, planCounts, typeCounts, methodCounts, totalsAgg] = await Promise.all([
    Company.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$accountStatus', count: { $sum: 1 } } }
    ]),
    Company.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$subscriptionPlan', count: { $sum: 1 } } }
    ]),
    Company.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$accountType', count: { $sum: 1 } } }
    ]),
    Company.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$verificationMethod', count: { $sum: 1 } } }
    ]),
    Company.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          totalSearches: { $sum: '$searchesUsed' },
          totalDownloads: { $sum: '$exportsUsed' },
          totalViews: { $sum: '$viewsUsed' },
          totalRevenueEgp: { $sum: '$subscriptionPriceEgp' }
        }
      }
    ])
  ]);

  const totalContacts = await CandidateInteraction.countDocuments();

  return {
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s._id || 'unknown', s.count])),
    planCounts: Object.fromEntries(planCounts.map((p) => [p._id || 'none', p.count])),
    typeCounts: Object.fromEntries(typeCounts.map((t) => [t._id || 'company', t.count])),
    methodCounts: Object.fromEntries(methodCounts.map((m) => [m._id || 'manual', m.count])),
    totals: {
      totalSearches: totalsAgg[0]?.totalSearches || 0,
      totalDownloads: totalsAgg[0]?.totalDownloads || 0,
      totalViews: totalsAgg[0]?.totalViews || 0,
      totalRevenueEgp: totalsAgg[0]?.totalRevenueEgp || 0,
      totalContacts
    }
  };
}

module.exports = {
  createEmployerAccount,
  getEligibleVerifyingCompanies,
  resetPasswordByAdmin,
  changeInitialPassword,
  updateAccountStatus,
  updateSubscriptionPlan,
  listEmployerAccounts,
  getAccountAnalytics,
  getActivityRankings,
  getBulkEmployerAnalytics
};
