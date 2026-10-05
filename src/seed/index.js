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

// No pre-seeded categories or job titles — admin adds all data via dashboard
const initialCategories = [];
const initialJobs = [];

/**
 * Remove all seeded dummy data including categories and jobs
 */
async function cleanSeededData() {
  console.log('[Cleanup] Cleaning all seeded data from database...');
  await Promise.all([
    Candidate.deleteMany({}),
    Company.deleteMany({}),
    Job.deleteMany({}),
    JobCategory.deleteMany({}),
    User.deleteMany({ role: { $ne: 'admin' } }),
    RecruitmentRequest.deleteMany({}),
    CandidateReport.deleteMany({})
  ]);
  console.log('[Cleanup] All seeded data removed successfully.');
}

/**
 * Seeds subscription tiers, system settings, and admin account only
 */
async function seedDatabase(force = false) {
  console.log('[Seed] Setting up base system data (settings, admin)...');

  if (force) {
    console.log('[Seed] Force flag enabled: clearing collections...');
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

  // Clear all categories and jobs — admin enters real data via dashboard
  await JobCategory.deleteMany({});
  await Job.deleteMany({});

  // 3. Subscriptions & System Settings
  await Subscription.findOneAndUpdate(
    { planName: 'Basic' },
    {
      planName: 'Basic',
      displayName: 'Standard Employer Plan',
      displayNameAr: 'الباقة الأساسية للشركات',
      priceMonthlyEgp: 50,
      searchLimitMonthly: 100,
      exportLimitMonthly: 25,
      viewLimitMonthly: 250,
      isActive: true,
      description: 'Monthly access to Asher Jobs candidate database for factory recruitment'
    },
    { upsert: true }
  );

  await SystemSetting.findOneAndUpdate(
    { key: 'company_monthly_price_egp' },
    { value: 50, description: 'Standard monthly subscription ceiling in Egyptian Pounds' },
    { upsert: true }
  );

  // 4. Admin Account
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

  console.log('[Seed] Base system configuration initialized. No dummy data seeded.');
}

async function autoSeedIfEmpty() {
  await seedDatabase(false);
  // Ensure any seeded dummy candidates, companies, or test users are wiped
  await cleanSeededData();
}

// Support direct script execution
if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      const force = process.argv.includes('--force');
      await seedDatabase(force);
      await cleanSeededData();
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
  cleanSeededData,
  autoSeedIfEmpty
};
