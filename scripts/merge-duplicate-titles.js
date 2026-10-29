#!/usr/bin/env node
/**
 * Standalone script to audit and merge duplicate job titles across categories in MongoDB.
 *
 * Usage:
 *   node scripts/merge-duplicate-titles.js
 *   node scripts/merge-duplicate-titles.js --uri="mongodb+srv://user:pass@cluster.mongodb.net/asher_jobs_db"
 *   node scripts/merge-duplicate-titles.js --dry-run
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { mergeDuplicateJobTitles } = require('../src/services/titleDeduplication.service');
const { connectDB, closeDB } = require('../src/config/db');

// Parse CLI flags
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const uriArg = args.find((a) => a.startsWith('--uri='));
const customUri = uriArg ? uriArg.split('=')[1].replace(/^["']|["']$/g, '') : null;

async function run() {
  console.log('====================================================');
  console.log('🔍 Asher Jobs - Job Titles Cross-Category Merge Tool');
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE MERGE'}`);
  console.log('====================================================');

  if (customUri) {
    console.log(`Connecting to custom MongoDB URI...`);
    await mongoose.connect(customUri, {
      dbName: 'asher_jobs_db',
      serverSelectionTimeoutMS: 10000
    });
    console.log('Connected to custom MongoDB.');
  } else {
    await connectDB();
  }

  const result = await mergeDuplicateJobTitles({ dryRun });

  console.log('\n================ MERGE REPORT ================');
  console.log(`Total jobs before:         ${result.totalBefore}`);
  console.log(`Duplicate groups found:    ${result.duplicateGroupsCount}`);
  console.log(`Duplicate titles merged:   ${result.mergedJobsCount}`);
  console.log(`Candidate records updated: ${result.candidatesUpdatedCount}`);
  console.log(`Total jobs after:          ${result.totalAfter}`);
  console.log('==============================================\n');

  if (customUri) {
    await mongoose.disconnect();
  } else {
    await closeDB();
  }

  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ [Error]', err);
  process.exit(1);
});
