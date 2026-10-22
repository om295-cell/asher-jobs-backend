const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Candidate = require('../models/Candidate');
const Company = require('../models/Company');
const Job = require('../models/Job');
const JobCategory = require('../models/JobCategory');
const Subscription = require('../models/Subscription');
const SystemSetting = require('../models/SystemSetting');
const RecruitmentRequest = require('../models/RecruitmentRequest');
const CandidateReport = require('../models/CandidateReport');
const { connectDB, closeDB } = require('../config/db');

/**
 * Seeds subscription tiers, system settings, and admin account only.
 * Does NOT wipe categories or jobs — admin manages those via the dashboard.
 */
async function seedDatabase(force = false) {
  console.log('[Seed] Setting up base system data (settings, admin)...');

  if (force) {
    console.log('[Seed] Force flag enabled: clearing all collections...');
    await Promise.all([
      User.deleteMany({}),
      Candidate.deleteMany({}),
      Company.deleteMany({}),
      Job.deleteMany({}),
      JobCategory.deleteMany({}),
      Subscription.deleteMany({}),
      SystemSetting.deleteMany({})
    ]);
  }

  // Seed Subscription Plans: Basic, Gold, Platinum
  const plansToSeed = [
    {
      planName: 'Basic',
      displayName: 'Basic Plan',
      displayNameAr: 'الباقة الأساسية',
      priceMonthlyEgp: 500,
      priceEgp: 500,
      billingCycleDays: 30,
      dailySearchLimit: 15,
      dailyDownloadLimitPerTitle: 3,
      maxCandidatesPerTitle: 10,
      cartEnabled: false,
      platinumBrowseEnabled: false,
      isActive: true,
      description: '15 searches/day, 3 downloads/title/day, up to 10 candidates per title'
    },
    {
      planName: 'Gold',
      displayName: 'Gold Plan',
      displayNameAr: 'الباقة الذهبية',
      priceMonthlyEgp: 1000,
      priceEgp: 1000,
      billingCycleDays: 30,
      dailySearchLimit: 20,
      dailyDownloadLimitPerTitle: 4,
      maxCandidatesPerTitle: 10,
      cartEnabled: true,
      platinumBrowseEnabled: false,
      isActive: true,
      description: '20 searches/day, 4 downloads/title/day, Multi-title candidate cart'
    },
    {
      planName: 'Platinum',
      displayName: 'Platinum Plan',
      displayNameAr: 'الباقة البلاتينية',
      priceMonthlyEgp: 2000,
      priceEgp: 2000,
      billingCycleDays: 30,
      dailySearchLimit: 30,
      dailyDownloadLimitPerTitle: 6,
      maxCandidatesPerTitle: 10,
      cartEnabled: true,
      platinumBrowseEnabled: true,
      isActive: true,
      description: '30 searches/day, 6 downloads/title/day, Multi-title cart, Unlimited database browsing (1 candidate at a time)'
    }
  ];

  for (const plan of plansToSeed) {
    await Subscription.findOneAndUpdate(
      { planName: plan.planName },
      plan,
      { upsert: true, new: true }
    );
  }

  // System setting
  await SystemSetting.findOneAndUpdate(
    { key: 'company_monthly_price_egp' },
    { value: 50, description: 'Standard monthly subscription ceiling in Egyptian Pounds' },
    { upsert: true }
  );

  // Admin account
  const defaultPasswordHash = await bcrypt.hash('Admin@123456', 10);
  await User.findOneAndUpdate(
    { email: 'admin@asherjobs.com' },
    {
      email: 'admin@asherjobs.com',
      phone: '01000000001',
      phoneNormalized: '+201000000001',
      passwordHash: defaultPasswordHash,
      role: 'admin',
      accountStatus: 'active'
    },
    { upsert: true }
  );

  // Seed sample verified company if no companies exist
  const companyCount = await Company.countDocuments();
  if (companyCount === 0) {
    const compUser = await User.findOneAndUpdate(
      { email: 'company@asherjobs.com' },
      {
        email: 'company@asherjobs.com',
        phone: '01000000002',
        phoneNormalized: '+201000000002',
        passwordHash: defaultPasswordHash,
        role: 'company',
        accountType: 'company',
        accountStatus: 'active',
        mustChangePassword: false
      },
      { upsert: true, new: true }
    );

    await Company.findOneAndUpdate(
      { userId: compUser._id },
      {
        userId: compUser._id,
        companyName: 'مجموعة العاشر للصناعات المتطورة',
        contactPerson: 'م. سامح إبراهيم',
        email: 'company@asherjobs.com',
        phone: '01000000002',
        governorate: 'الشرقية',
        area: 'العاشر من رمضان',
        accountType: 'company',
        verificationMethod: 'manual',
        verificationStatus: 'Approved',
        accountStatus: 'active',
        subscriptionPlan: 'Platinum',
        subscriptionPriceEgp: 2000,
        monthlyPriceEgp: 2000,
        mustChangePassword: false
      },
      { upsert: true }
    );
    console.log('[Seed] Sample verified company created.');
  }

  console.log('[Seed] Base system configuration initialized.');
}

/**
 * Runs on cold start. Only ensures admin + settings exist if missing.
 * Never wipes categories, jobs, or any admin-created data.
 */
async function autoSeedIfEmpty() {
  try {
    // Clean up any legacy system Uncategorized category if unused
    await JobCategory.deleteMany({
      $or: [{ name: 'Uncategorized' }, { nameAr: 'غير مصنف' }]
    }).catch(() => {});

    // Always ensure subscription plans exist (upsert is safe and idempotent)
    const plansToSeed = [
      {
        planName: 'Basic',
        displayName: 'Basic Plan',
        displayNameAr: 'الباقة الأساسية',
        priceMonthlyEgp: 500,
        priceEgp: 500,
        billingCycleDays: 30,
        dailySearchLimit: 15,
        dailyDownloadLimitPerTitle: 3,
        maxCandidatesPerTitle: 10,
        cartEnabled: false,
        platinumBrowseEnabled: false,
        isActive: true,
        description: '15 searches/day, 3 downloads/title/day, up to 10 candidates per title'
      },
      {
        planName: 'Gold',
        displayName: 'Gold Plan',
        displayNameAr: 'الباقة الذهبية',
        priceMonthlyEgp: 1000,
        priceEgp: 1000,
        billingCycleDays: 30,
        dailySearchLimit: 20,
        dailyDownloadLimitPerTitle: 4,
        maxCandidatesPerTitle: 10,
        cartEnabled: true,
        platinumBrowseEnabled: false,
        isActive: true,
        description: '20 searches/day, 4 downloads/title/day, Multi-title candidate cart'
      },
      {
        planName: 'Platinum',
        displayName: 'Platinum Plan',
        displayNameAr: 'الباقة البلاتينية',
        priceMonthlyEgp: 2000,
        priceEgp: 2000,
        billingCycleDays: 30,
        dailySearchLimit: 30,
        dailyDownloadLimitPerTitle: 6,
        maxCandidatesPerTitle: 10,
        cartEnabled: true,
        platinumBrowseEnabled: true,
        isActive: true,
        description: '30 searches/day, 6 downloads/title/day, Multi-title cart, Free database browsing (1 at a time)'
      }
    ];
    for (const plan of plansToSeed) {
      await Subscription.findOneAndUpdate(
        { planName: plan.planName },
        { $setOnInsert: plan }, // only insert if missing, never overwrite admin edits
        { upsert: true, new: true }
      );
    }

    // Ensure all 10 standard categories and comprehensive job catalog are synchronized and deduplicated
    try {
      const { syncJobCatalog } = require('./seed-full-catalog');
      await syncJobCatalog();
    } catch (syncErr) {
      console.warn('[Seed] syncJobCatalog warning:', syncErr.message);
    }

    // If admin doesn't exist yet, do the full seed
    const adminExists = await User.exists({ role: 'admin' });
    if (adminExists) {
      return;
    }
    await seedDatabase(false);
  } catch (err) {
    console.warn('[Seed] autoSeed check warning:', err.message);
  }
}

// Support direct script execution
if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      const force = process.argv.includes('--force');
      await seedDatabase(force);
      await closeDB();
      process.exit(0);
    } catch (err) {
      console.error('[Seed Error]', err);
      process.exit(1);
    }
  })();
}

module.exports = {
  seedDatabase,
  autoSeedIfEmpty
};
