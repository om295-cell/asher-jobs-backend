const Company = require('../models/Company');
const Subscription = require('../models/Subscription');
const DailyQuotaUsage = require('../models/DailyQuotaUsage');
const { logActivity } = require('./activity.service');

/**
 * Returns the calendar date string (YYYY-MM-DD) for Africa/Cairo timezone
 */
function getCairoDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(date);
}

/**
 * Calculates remaining milliseconds until midnight Africa/Cairo
 */
function getMsUntilCairoMidnight(date = new Date()) {
  const cairoStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);

  const parts = cairoStr.match(/(\d+)\/(\d+)\/(\d+),\s+(\d+):(\d+):(\d+)/);
  if (!parts) return 24 * 60 * 60 * 1000;

  const hours = parseInt(parts[4], 10);
  const minutes = parseInt(parts[5], 10);
  const seconds = parseInt(parts[6], 10);

  const elapsedSeconds = hours * 3600 + minutes * 60 + seconds;
  const remainingSeconds = 86400 - elapsedSeconds;
  return Math.max(1000, remainingSeconds * 1000);
}

/**
 * Resolves plan limits for a company, pulling dynamic limits from Subscription model with defaults
 */
async function getPlanLimits(planName = 'Basic') {
  const normPlan = planName || 'Basic';
  const subPlan = await Subscription.findOne({ planName: normPlan, isActive: true }).lean();

  if (normPlan === 'Platinum') {
    return {
      planName: 'Platinum',
      dailySearchLimit: subPlan?.dailySearchLimit ?? 30,
      dailyDownloadLimitPerTitle: subPlan?.dailyDownloadLimitPerTitle ?? 6,
      maxCandidatesPerTitle: 10,
      cartEnabled: true,
      platinumBrowseEnabled: true
    };
  }

  if (normPlan === 'Gold') {
    return {
      planName: 'Gold',
      dailySearchLimit: subPlan?.dailySearchLimit ?? 20,
      dailyDownloadLimitPerTitle: subPlan?.dailyDownloadLimitPerTitle ?? 4,
      maxCandidatesPerTitle: 10,
      cartEnabled: true,
      platinumBrowseEnabled: false
    };
  }

  // Basic (Default)
  return {
    planName: 'Basic',
    dailySearchLimit: subPlan?.dailySearchLimit ?? 15,
    dailyDownloadLimitPerTitle: subPlan?.dailyDownloadLimitPerTitle ?? 3,
    maxCandidatesPerTitle: 10,
    cartEnabled: false,
    platinumBrowseEnabled: false
  };
}

/**
 * Validates company account status, verification, and subscription validity
 */
async function validateCompanyAccess(companyId) {
  const company = await Company.findById(companyId);
  if (!company || company.isDeleted) {
    throw { statusCode: 404, message: 'Company account not found.', code: 'COMPANY_NOT_FOUND' };
  }

  if (company.isBlocked || company.accountStatus === 'banned') {
    throw {
      statusCode: 403,
      message: company.blockReason || 'Account is banned by administrators.',
      code: 'ACCOUNT_BANNED'
    };
  }

  if (company.accountStatus === 'suspended' || company.accountStatus === 'on_hold') {
    throw {
      statusCode: 403,
      message: 'Account is currently on hold or suspended. Access is restricted.',
      code: 'ACCOUNT_SUSPENDED'
    };
  }

  if (company.verificationStatus !== 'Approved') {
    throw {
      statusCode: 403,
      message: `Account verification status is ${company.verificationStatus}. Access is not permitted.`,
      code: 'ACCOUNT_NOT_APPROVED'
    };
  }

  if (company.subscriptionStatus !== 'active') {
    throw {
      statusCode: 403,
      message: 'Subscription is inactive. Please renew your subscription to access candidate database.',
      code: 'SUBSCRIPTION_INACTIVE'
    };
  }

  if (company.subscriptionEndDate && new Date(company.subscriptionEndDate) < new Date()) {
    throw {
      statusCode: 403,
      message: 'Subscription has expired. Please contact administration to renew.',
      code: 'SUBSCRIPTION_EXPIRED'
    };
  }

  return company;
}

/**
 * Enforces and consumes a daily search quota in Africa/Cairo timezone
 */
async function checkAndConsumeSearchQuota(companyId, req = null) {
  const company = await validateCompanyAccess(companyId);
  const planLimits = await getPlanLimits(company.subscriptionPlan);
  const cairoDate = getCairoDateString();

  // Atomically find or create today's usage document
  const usage = await DailyQuotaUsage.findOneAndUpdate(
    { companyId, cairoDate },
    { $setOnInsert: { companyId, cairoDate, searchesCount: 0, downloadsByJob: {} } },
    { upsert: true, new: true }
  );

  if (usage.searchesCount >= planLimits.dailySearchLimit) {
    const msLeft = getMsUntilCairoMidnight();
    const hoursLeft = Math.ceil(msLeft / (1000 * 60 * 60));
    throw {
      statusCode: 429,
      code: 'DAILY_SEARCH_LIMIT_REACHED',
      message: `لقد استنفدت الحد اليومي لعمليات البحث (${planLimits.dailySearchLimit} بحث/يوم) لباقة ${planLimits.planName}. يتجدد الرصيد عند منتصف الليل بتوقيت القاهرة (خلال ${hoursLeft} ساعة تقريباً).`,
      dailyLimit: planLimits.dailySearchLimit,
      used: usage.searchesCount,
      resetInMs: msLeft,
      plan: planLimits.planName
    };
  }

  // Atomically increment search count
  usage.searchesCount += 1;
  await usage.save();

  // Increment total historical searches
  company.searchesUsed = (company.searchesUsed || 0) + 1;
  await company.save().catch(() => {});

  if (req) {
    await logActivity({
      actorId: company.userId,
      actorRole: 'company',
      companyId: company._id,
      action: 'SEARCH_PERFORMED',
      entityType: 'Company',
      entityId: company._id,
      metadata: { cairoDate, countToday: usage.searchesCount, plan: planLimits.planName },
      req
    }).catch(() => {});
  }

  return {
    searchesCount: usage.searchesCount,
    searchesRemaining: Math.max(0, planLimits.dailySearchLimit - usage.searchesCount),
    planLimits
  };
}

/**
 * Enforces and consumes a daily download quota for a specific job title
 */
async function checkAndConsumeDownloadQuota(companyId, jobId, count = 1, req = null) {
  if (!jobId) {
    throw { statusCode: 400, message: 'Job title is required for quota tracking.', code: 'JOB_REQUIRED' };
  }

  const company = await validateCompanyAccess(companyId);
  const planLimits = await getPlanLimits(company.subscriptionPlan);
  const cairoDate = getCairoDateString();
  const jobKey = String(jobId);

  const usage = await DailyQuotaUsage.findOneAndUpdate(
    { companyId, cairoDate },
    { $setOnInsert: { companyId, cairoDate, searchesCount: 0, downloadsByJob: {} } },
    { upsert: true, new: true }
  );

  const currentJobDownloads = (usage.downloadsByJob && usage.downloadsByJob.get(jobKey)) || 0;

  if (currentJobDownloads + count > planLimits.dailyDownloadLimitPerTitle) {
    const msLeft = getMsUntilCairoMidnight();
    const hoursLeft = Math.ceil(msLeft / (1000 * 60 * 60));
    throw {
      statusCode: 429,
      code: 'DAILY_DOWNLOAD_LIMIT_REACHED',
      message: `لقد استنفدت الحد اليومي لتنزيل ملفات الإكسيل لهذا التخصص (${planLimits.dailyDownloadLimitPerTitle} ملفات/يوم لكل مسمى وظيفي) لباقة ${planLimits.planName}. يتجدد الرصيد عند منتصف الليل بتوقيت القاهرة (خلال ${hoursLeft} ساعة تقريباً).`,
      dailyLimitPerTitle: planLimits.dailyDownloadLimitPerTitle,
      usedForThisJob: currentJobDownloads,
      jobId,
      resetInMs: msLeft,
      plan: planLimits.planName
    };
  }

  // Update map
  const updatedCount = currentJobDownloads + count;
  usage.downloadsByJob.set(jobKey, updatedCount);
  await usage.save();

  company.exportsUsed = (company.exportsUsed || 0) + count;
  await company.save().catch(() => {});

  if (req) {
    await logActivity({
      actorId: company.userId,
      actorRole: 'company',
      companyId: company._id,
      action: 'DOWNLOAD_PERFORMED',
      entityType: 'Company',
      entityId: company._id,
      metadata: { cairoDate, jobId, countForJob: updatedCount, plan: planLimits.planName },
      req
    }).catch(() => {});
  }

  return {
    downloadsForJob: updatedCount,
    downloadsRemainingForJob: Math.max(0, planLimits.dailyDownloadLimitPerTitle - updatedCount),
    planLimits
  };
}

/**
 * Validates and records Platinum single-candidate view or download
 */
async function recordPlatinumCandidateAction(companyId, candidateId, actionType = 'view', req = null) {
  const company = await validateCompanyAccess(companyId);
  const planLimits = await getPlanLimits(company.subscriptionPlan);

  if (!planLimits.platinumBrowseEnabled) {
    throw {
      statusCode: 403,
      message: 'خاصية تصفح قاعدة البيانات متاحة فقط لمشتركي الباقة البلاتينية (Platinum).',
      code: 'PLATINUM_REQUIRED'
    };
  }

  if (!candidateId || typeof candidateId !== 'string' || candidateId.includes(',')) {
    throw {
      statusCode: 400,
      message: 'نظام التصفح في الباقة البلاتينية يسمح باستعراض أو تنزيل مرشح واحد فقط في كل مرة.',
      code: 'PLATINUM_SINGLE_CANDIDATE_ONLY'
    };
  }

  const cairoDate = getCairoDateString();
  const usage = await DailyQuotaUsage.findOneAndUpdate(
    { companyId, cairoDate },
    { $setOnInsert: { companyId, cairoDate, searchesCount: 0, downloadsByJob: {} } },
    { upsert: true, new: true }
  );

  if (actionType === 'download') {
    usage.platinumDownloads.push({ candidateId, downloadedAt: new Date() });
  } else {
    usage.platinumViews.push({ candidateId, viewedAt: new Date() });
  }
  await usage.save();

  if (req) {
    await logActivity({
      actorId: company.userId,
      actorRole: 'company',
      companyId: company._id,
      action: actionType === 'download' ? 'PLATINUM_CANDIDATE_DOWNLOAD' : 'PLATINUM_CANDIDATE_VIEW',
      entityType: 'Candidate',
      entityId: candidateId,
      metadata: { actionType, cairoDate },
      req
    }).catch(() => {});
  }

  return { success: true, candidateId, actionType };
}

/**
 * Returns complete entitlement and quota status for an employer account
 */
async function getAccountEntitlementSummary(companyId) {
  const company = await Company.findById(companyId).populate('verifiedByCompanyId', 'companyName email');
  if (!company) {
    throw { statusCode: 404, message: 'Company not found', code: 'COMPANY_NOT_FOUND' };
  }

  const planLimits = await getPlanLimits(company.subscriptionPlan);
  const cairoDate = getCairoDateString();
  const msUntilMidnight = getMsUntilCairoMidnight();

  const usage = await DailyQuotaUsage.findOne({ companyId, cairoDate }).lean();
  const searchesUsedToday = usage?.searchesCount || 0;
  const searchesRemainingToday = Math.max(0, planLimits.dailySearchLimit - searchesUsedToday);

  // Convert downloads map to standard object
  const downloadsByJobObj = {};
  if (usage?.downloadsByJob) {
    if (usage.downloadsByJob instanceof Map) {
      usage.downloadsByJob.forEach((val, key) => {
        downloadsByJobObj[key] = val;
      });
    } else {
      Object.assign(downloadsByJobObj, usage.downloadsByJob);
    }
  }

  return {
    company: {
      id: company._id,
      companyName: company.companyName,
      contactPerson: company.contactPerson,
      email: company.email,
      accountType: company.accountType || 'company',
      verificationMethod: company.verificationMethod || 'manual',
      verificationStatus: company.verificationStatus,
      accountStatus: company.accountStatus || 'active',
      subscriptionPlan: company.subscriptionPlan || 'Basic',
      subscriptionStatus: company.subscriptionStatus,
      subscriptionStartDate: company.subscriptionStartDate,
      subscriptionEndDate: company.subscriptionEndDate,
      subscriptionPriceEgp: company.subscriptionPriceEgp || 0,
      mustChangePassword: company.mustChangePassword || false
    },
    planLimits,
    quota: {
      cairoDate,
      resetInMs: msUntilMidnight,
      searchesUsedToday,
      searchesRemainingToday,
      downloadsByJob: downloadsByJobObj,
      dailyDownloadLimitPerTitle: planLimits.dailyDownloadLimitPerTitle
    }
  };
}

module.exports = {
  getCairoDateString,
  getMsUntilCairoMidnight,
  getPlanLimits,
  validateCompanyAccess,
  checkAndConsumeSearchQuota,
  checkAndConsumeDownloadQuota,
  recordPlatinumCandidateAction,
  getAccountEntitlementSummary
};
