const mongoose = require('mongoose');
const path = require('path');
const Job = require('../models/Job');
const JobCategory = require('../models/JobCategory');
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

/**
 * Synchronizes categories and job catalog idempotently.
 * Updates existing jobs to proper categories so candidate references remain intact.
 */
async function syncJobCatalog() {
  console.log('[JobCatalog] Starting category & job synchronization...');

  // 1. Ensure all 10 categories exist and have proper bilingual names & sortOrder
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

  // 2. Upsert each master job
  let createdCount = 0;
  let updatedCount = 0;

  for (let i = 0; i < MASTER_JOBS.length; i++) {
    const j = MASTER_JOBS[i];
    const targetCatId = catMap[j.category];
    if (!targetCatId) continue;

    // Search for existing job matching either English or Arabic name
    const existing = await Job.findOne({
      $or: [
        { name: j.name },
        { nameAr: j.nameAr }
      ]
    });

    if (existing) {
      let needsSave = false;
      if (String(existing.categoryId) !== String(targetCatId)) {
        existing.categoryId = targetCatId;
        needsSave = true;
      }
      if (!existing.isActive) {
        existing.isActive = true;
        needsSave = true;
      }
      if (existing.name !== j.name) {
        existing.name = j.name;
        needsSave = true;
      }
      if (existing.nameAr !== j.nameAr) {
        existing.nameAr = j.nameAr;
        needsSave = true;
      }
      if (needsSave) {
        await existing.save();
        updatedCount++;
      }
    } else {
      // Create new job
      try {
        await Job.create({
          name: j.name,
          nameAr: j.nameAr,
          categoryId: targetCatId,
          isActive: true,
          sortOrder: i + 1
        });
        createdCount++;
      } catch (err) {
        // If unique index collision on name within same category, append number or skip
        console.warn(`[JobCatalog] Skipped creating duplicate '${j.name}': ${err.message}`);
      }
    }
  }

  console.log(`[JobCatalog] Synchronization finished. Created: ${createdCount}, Updated: ${updatedCount}`);
  return { createdCount, updatedCount };
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
