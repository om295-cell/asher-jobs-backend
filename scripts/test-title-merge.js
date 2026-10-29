const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Job = require('../src/models/Job');
const JobCategory = require('../src/models/JobCategory');
const Candidate = require('../src/models/Candidate');
const CandidateCart = require('../src/models/CandidateCart');
const User = require('../src/models/User');
const { mergeDuplicateJobTitles } = require('../src/services/titleDeduplication.service');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✓ PASS: ${message}`);
}

async function runTest() {
  console.log('--- Starting Title Deduplication Unit Test ---');
  const mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  // 1. Create two categories: Engineering and Quality & Inspection
  const catEng = await JobCategory.create({ name: 'Engineering', nameAr: 'هندسة', sortOrder: 4 });
  const catQuality = await JobCategory.create({ name: 'Quality & Inspection', nameAr: 'جودة وفحص', sortOrder: 5 });

  // Drop unique index to simulate legacy database state where duplicates existed
  await Job.collection.dropIndexes().catch(() => {});
  await Job.collection.createIndex({ name: 1, categoryId: 1 });

  // 2. Create duplicate titles in different categories:
  // Title A: Quality Engineer in Engineering
  // Title B: Quality Engineer in Quality & Inspection
  const jobEng = await Job.create({
    name: 'Quality Engineer',
    nameAr: 'مهندس جودة',
    categoryId: catEng._id,
    isActive: true
  });

  const jobQuality = await Job.create({
    name: 'Quality Engineer',
    nameAr: 'مهندس جودة',
    categoryId: catQuality._id,
    isActive: true
  });

  console.log(`Created Job Eng (${jobEng._id}) in ${catEng.name}`);
  console.log(`Created Job Quality (${jobQuality._id}) in ${catQuality.name}`);

  // 3. Create dummy user and candidate linked to jobEng
  const user1 = await User.create({
    email: 'test@candidate.com',
    phone: '01011112222',
    phoneNormalized: '+201011112222',
    passwordHash: 'hash',
    role: 'candidate'
  });

  const cand1 = await Candidate.create({
    userId: user1._id,
    fullName: 'Ahmed Test',
    phone: '01011112222',
    phoneNormalized: '+201011112222',
    desiredJobId: jobEng._id,
    secondJobId: jobQuality._id,
    desiredJobs: [
      { jobId: jobEng._id, jobTitle: 'Quality Engineer', jobTitleAr: 'مهندس جودة', priority: 1 },
      { jobId: jobQuality._id, jobTitle: 'Quality Engineer', jobTitleAr: 'مهندس جودة', priority: 2 }
    ],
    consentGiven: true
  });

  // Verify before merge
  let totalJobs = await Job.countDocuments();
  assert(totalJobs === 2, 'Initially 2 duplicate jobs exist in database');

  // 4. Run mergeDuplicateJobTitles
  const result = await mergeDuplicateJobTitles();

  // 5. Assert results
  totalJobs = await Job.countDocuments();
  assert(totalJobs === 1, `Total jobs after merge is 1 (got ${totalJobs})`);

  const remainingJob = await Job.findOne();
  assert(remainingJob.name === 'Quality Engineer', 'Remaining job name is "Quality Engineer"');
  // Quality Engineer should belong to Quality & Inspection based on preferred category
  assert(
    String(remainingJob.categoryId) === String(catQuality._id),
    'Remaining job assigned to preferred category (Quality & Inspection)'
  );

  // Check candidate references
  const updatedCand = await Candidate.findById(cand1._id);
  assert(
    String(updatedCand.desiredJobId) === String(remainingJob._id),
    'Candidate desiredJobId updated to canonical job ID'
  );
  assert(
    updatedCand.secondJobId === null,
    'Candidate secondJobId cleared because desiredJobId is already the canonical job'
  );
  assert(
    updatedCand.desiredJobs.length === 1,
    `Candidate desiredJobs array deduplicated to 1 item (got ${updatedCand.desiredJobs.length})`
  );
  assert(
    String(updatedCand.desiredJobs[0].jobId) === String(remainingJob._id),
    'Candidate desiredJobs[0].jobId matches canonical job ID'
  );

  console.log('\n--- All Unit Tests Passed Successfully! ---');
  await mongoose.disconnect();
  await mongoServer.stop();
  process.exit(0);
}

runTest().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
