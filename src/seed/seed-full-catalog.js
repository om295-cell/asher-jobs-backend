const mongoose = require('mongoose');
const path = require('path');
const Job = require('../models/Job');
const JobCategory = require('../models/JobCategory');
const Candidate = require('../models/Candidate');
const { connectDB, closeDB } = require('../config/db');

const MASTER_JOBS = require('./catalog-jobs-master.json');

const CATEGORIES = [
  { name: 'Accounting & Finance',       nameAr: 'محاسبة ومالية',               sortOrder: 1 },
  { name: 'Warehousing & Logistics',    nameAr: 'مخازن ولوجستيات',             sortOrder: 2 },
  { name: 'HR & Administration',        nameAr: 'موارد بشرية وإدارة',          sortOrder: 3 },
  { name: 'Engineering',                nameAr: 'هندسة',                        sortOrder: 4 },
  { name: 'Quality & Inspection',       nameAr: 'جودة وفحص',                   sortOrder: 5 },
  { name: 'Maintenance & Technical',    nameAr: 'صيانة وفني',                  sortOrder: 6 },
  { name: 'Production & Manufacturing', nameAr: 'إنتاج وتصنيع',                sortOrder: 7 },
  { name: 'Sales & Marketing',          nameAr: 'مبيعات وتسويق',               sortOrder: 8 },
  { name: 'Drivers & Logistics',        nameAr: 'سائقين وخدمات لوجستية',       sortOrder: 9 },
  { name: 'Specialized & Other',        nameAr: 'تخصصات أخرى',                 sortOrder: 10 },
];

// Aliases mapping old or duplicated variations to master job canonical name
const ALIASES = {
  'محاسبة': 'Accountant',
  'accountant': 'Accountant',
  'financial manager': 'Finance Manager',
  'مدير مالى': 'Finance Manager',
  'مدير مالي': 'Finance Manager',
  'محاسب عملاء': 'Accounts Receivable',
  'customer accounts accountant': 'Accounts Receivable',
  'مراجع فواتير و شيكات': 'Auditor',
  'مراجع حسابات': 'Auditor',
  'internal audit': 'Internal Auditor',
  'مراجع داخلي': 'Internal Auditor',
  'مدير حسابات و مخازن': 'Warehouse & Accounts Manager',
  'مدير حسابات ومخازن': 'Warehouse & Accounts Manager',
  'محاسب موقع ومشتريات': 'Site & Purchasing Accountant',
  'كاشير': 'Cashier',
  'cashier': 'Cashier',
  'store keeper': 'Storekeeper',
  'أمين مخزن': 'Storekeeper',
  'warehouse supervisor': 'Warehouse Supervisor',
  'مشرف مخازن': 'Warehouse Supervisor',
  'logistics specialist': 'Logistics Specialist',
  'أخصائي لوجستيات': 'Logistics Specialist',
  'hr personnel manager': 'Personnel Manager',
  'مدير شؤون العاملين': 'Personnel Manager',
  'مدير شؤن عاملين': 'Personnel Manager',
  'مدير شئون العاملين': 'Personnel Manager',
  'مدير شئون عاملين': 'Personnel Manager',
  'project manager': 'Project Manager',
  'مدير مشروع': 'Project Manager',
  'assistant manager': 'Assistant Manager',
  'مساعد مدير': 'Assistant Manager',
  'receptionist': 'Receptionist',
  'موظف استقبال': 'Receptionist',
  'executive engineer': 'Executive Engineer',
  'مهندس تنفيذي': 'Executive Engineer',
  'quality engineer': 'Quality Engineer',
  'مهندس جودة': 'Quality Engineer',
  'chemist': 'Chemist',
  'كيميائي': 'Chemist',
  'content writer': 'Content Writer & Copywriter',
  'كاتب محتوى': 'Content Writer & Copywriter',
  'copywriter': 'Content Writer & Copywriter',
  'medical rep': 'Medical Representative',
  'medical representative': 'Medical Representative',
  'مندوب دعاية طبية': 'Medical Representative',
  'security guard': 'Security Guard',
  'فرد أمن': 'Security Guard',
  'فرد أمن security guard': 'Security Guard',
  'office manger': 'Office Manager',
  'مدير مكتب': 'Office Manager',
  'timekeeper': 'Timekeeper',
  'time keeper': 'Timekeeper',
  'مراقب وقت': 'Timekeeper',
  'مراقب وقت (timekeeper)': 'Timekeeper'
};

function normalize(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/[\u064B-\u065F\u0670\s\(\)\-_]/g, '').trim();
}

/**
 * Synchronizes categories and job catalog idempotently.
 * Moves miscategorized jobs, deduplicates jobs, and updates candidate references.
 */
async function syncJobCatalog() {
  console.log('[JobCatalog] Starting category & job synchronization...');

  // 1. Ensure all 10 categories exist with proper names & sortOrder
  const catMap = {};
  for (const cat of CATEGORIES) {
    let catDoc = await JobCategory.findOne({
      $or: [{ name: cat.name }, { nameAr: cat.nameAr }]
    });

    if (catDoc) {
      catDoc.name = cat.name;
      catDoc.nameAr = cat.nameAr;
      catDoc.sortOrder = cat.sortOrder;
      catDoc.isActive = true;
      await catDoc.save();
    } else {
      catDoc = await JobCategory.create({
        name: cat.name,
        nameAr: cat.nameAr,
        sortOrder: cat.sortOrder,
        isActive: true
      });
    }
    catMap[cat.name] = catDoc._id;
    catMap[cat.nameAr] = catDoc._id;
  }
  console.log(`[JobCatalog] Synchronized ${CATEGORIES.length} categories.`);

  const accountingCatId = catMap['Accounting & Finance'];
  const warehousingCatId = catMap['Warehousing & Logistics'];
  const hrCatId = catMap['HR & Administration'];
  const engineeringCatId = catMap['Engineering'];
  const qualityCatId = catMap['Quality & Inspection'];
  const maintenanceCatId = catMap['Maintenance & Technical'];
  const productionCatId = catMap['Production & Manufacturing'];
  const salesCatId = catMap['Sales & Marketing'];
  const driversCatId = catMap['Drivers & Logistics'];
  const specializedCatId = catMap['Specialized & Other'];

  // 2. Ensure each canonical master job exists and is up-to-date (fast bulk operations)
  const masterJobMap = new Map();
  let createdCount = 0;
  let updatedCount = 0;

  // Build bulkWrite operations for MASTER_JOBS (match by unique name)
  const bulkOps = [];
  for (let i = 0; i < MASTER_JOBS.length; i++) {
    const m = MASTER_JOBS[i];
    const targetCatId = catMap[m.category];
    if (!targetCatId) continue;

    bulkOps.push({
      updateOne: {
        filter: { name: m.name },
        update: {
          $set: {
            name: m.name,
            nameAr: m.nameAr,
            categoryId: targetCatId,
            isActive: true,
            sortOrder: i + 1
          }
        },
        upsert: true
      }
    });
  }

  // Execute bulkWrite in chunks of 250
  for (let i = 0; i < bulkOps.length; i += 250) {
    const chunk = bulkOps.slice(i, i + 250);
    const res = await Job.bulkWrite(chunk, { ordered: false });
    createdCount += res.upsertedCount || 0;
    updatedCount += res.modifiedCount || 0;
  }

  // 3. Comprehensive Cross-Category Deduplication & Reference Merge
  const { mergeDuplicateJobTitles } = require('../services/titleDeduplication.service');
  const dedupResult = await mergeDuplicateJobTitles();
  const mergedCount = dedupResult.mergedJobsCount;
  const movedCount = 0;

  // 4. Clean up any obsolete uncategorized or inactive duplicate jobs
  await JobCategory.deleteMany({
    $or: [{ name: 'Uncategorized' }, { nameAr: 'غير مصنف' }]
  }).catch(() => {});

  console.log(`[JobCatalog] Done! Created: ${createdCount}, Updated: ${updatedCount}, Moved: ${movedCount}, Merged/Deleted Dupes: ${mergedCount}`);
  return { createdCount, updatedCount, movedCount, mergedCount };
}

// Standalone runner
if (require.main === module) {
  (async () => {
    try {
      await connectDB();
      await syncJobCatalog();
      await closeDB();
      console.log('[JobCatalog] Completed successfully.');
      process.exit(0);
    } catch (err) {
      console.error('[JobCatalog Error]', err);
      process.exit(1);
    }
  })();
}

module.exports = {
  syncJobCatalog,
  CATEGORIES,
  MASTER_JOBS
};
