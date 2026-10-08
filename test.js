/**
 * Manual Batch Flow Tests
 * Run: node test.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const { parseLinesFromRawText } = require('./src/services/titleExtraction.service');

// ─── Parser unit tests (no DB needed) ────────────────────────────────────────
function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    process.exitCode = 1;
  }
}

function runParserTests() {
  console.log('\n=== Parser Unit Tests ===');

  // 1. Four newline-separated Arabic titles
  let r = parseLinesFromRawText('محاسب مالي\nمحاسب تكاليف\nمراجع حسابات\nأمين مخزن');
  assert(r.length === 4, '4 newline-separated Arabic titles → 4 records');
  assert(r[0] === 'محاسب مالي', 'First Arabic title correct');

  // 2. Four newline-separated English titles
  r = parseLinesFromRawText('Electrician\nWelder\nCNC Operator\nQuality Inspector');
  assert(r.length === 4, '4 newline-separated English titles → 4 records');

  // 3. Mixed Arabic/English
  r = parseLinesFromRawText('فني صيانة Mechanical\nمهندس كهرباء Electrical');
  assert(r.length === 2, 'Mixed Arabic/English titles → 2 records');

  // 4. Blank lines ignored
  r = parseLinesFromRawText('محاسب مالي\n\n\nمحاسب تكاليف\n\n');
  assert(r.length === 2, 'Blank lines ignored');

  // 5. Leading/trailing whitespace trimmed
  r = parseLinesFromRawText('  محاسب مالي  \n  محاسب تكاليف  ');
  assert(r.length === 2, 'Whitespace trimmed');
  assert(r[0] === 'محاسب مالي', 'Leading/trailing spaces removed');

  // 6. Numbered multiline input
  r = parseLinesFromRawText('1. محاسب مالي\n2. محاسب تكاليف\n3. مراجع حسابات');
  assert(r.length === 3, 'Numbered multiline → 3 records');
  assert(r[0] === 'محاسب مالي', 'Number prefix stripped from first');

  // 7. Inline numbered input (all on one line)
  r = parseLinesFromRawText('1. محاسب مالي 2. محاسب تكاليف 3. مراجع حسابات 4. أمين مخزن');
  assert(r.length === 4, 'Inline numbered → 4 records');
  assert(r[0] === 'محاسب مالي', 'First inline title correct');
  assert(r[3] === 'أمين مخزن', 'Last inline title correct');

  // 8. Empty input → empty array
  r = parseLinesFromRawText('');
  assert(r.length === 0, 'Empty input → empty array');

  // 9. Garbage strings filtered
  r = parseLinesFromRawText('%%EOF\nendobj\nHP7O7RdS\nZ21260409174625Z\nكهربائي\nWelder');
  assert(r.length === 2, 'Garbage strings filtered, valid titles kept');
  assert(r.includes('كهربائي'), 'Arabic title preserved through garbage filter');
  assert(r.includes('Welder'), 'English title preserved through garbage filter');

  // 10. 100+ titles without truncation
  const bigInput = Array.from({ length: 120 }, (_, i) => `مسمى وظيفي ${i + 1}`).join('\n');
  r = parseLinesFromRawText(bigInput);
  assert(r.length === 120, '120 titles parsed without truncation');

  // 11. Arabic Unicode intact
  r = parseLinesFromRawText('مهندس كهرباء');
  assert(r[0] === 'مهندس كهرباء', 'Arabic Unicode preserved exactly');

  // 12. Numbers that are part of a real title not stripped
  r = parseLinesFromRawText('مطور تطبيقات (Flutter)\nفني CNC');
  assert(r.length === 2, 'Titles with parentheses/mixed content parsed');
}

// ─── Integration test (requires DB) ──────────────────────────────────────────
async function runIntegrationTest() {
  console.log('\n=== Integration Test (DB) ===');
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.log('  ⚠ MONGO_URI not set — skipping DB integration test');
    return;
  }

  await mongoose.connect(MONGO_URI);
  console.log('  Connected to DB');

  const service = require('./src/services/jobTitleReview.service');
  const JobTitleReview = require('./src/models/JobTitleReview');
  const JobTitleBatch = require('./src/models/JobTitleBatch');
  const JobCategory = require('./src/models/JobCategory');

  const mockActor = { _id: new mongoose.Types.ObjectId(), role: 'admin' };
  const mockReq = { ip: '127.0.0.1' };
  const testKey = `test-${Date.now()}`;

  // Create batch with 4 Arabic titles
  const text = 'محاسب مالي\nمحاسب تكاليف\nمراجع حسابات\nأمين مخزن';
  let batch;
  try {
    batch = await service.createManualBatch({ text, idempotencyKey: testKey, actor: mockActor, req: mockReq });
    assert(batch, 'Batch created successfully');
    assert(batch.totalTitles === 4, `Batch has 4 titles (got ${batch.totalTitles})`);
  } catch (err) {
    console.error('  ✗ FAIL: createManualBatch threw:', err.message || err);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  // Verify review records
  const reviews = await JobTitleReview.find({ batchId: batch._id }).lean();
  assert(reviews.length === 4, `4 review records in DB (got ${reviews.length})`);

  const titles = reviews.map(r => r.originalTitle).sort();
  assert(titles.includes('محاسب مالي'), 'محاسب مالي record exists');
  assert(titles.includes('أمين مخزن'), 'أمين مخزن record exists');

  // Verify no numbering prefix in stored titles
  assert(!reviews.some(r => /^\d/.test(r.originalTitle)), 'No numbering prefix in stored titles');

  // Verify Uncategorized category assigned
  const cat = await JobCategory.findById(reviews[0].categoryId).lean();
  assert(cat && (cat.name === 'Uncategorized' || cat.nameAr === 'غير مصنف'), 'Category is Uncategorized');

  // Verify no blank records
  assert(!reviews.some(r => !r.originalTitle?.trim()), 'No blank records created');

  // Idempotency: same key returns same batch
  const batch2 = await service.createManualBatch({ text, idempotencyKey: testKey, actor: mockActor, req: mockReq });
  assert(String(batch2._id) === String(batch._id), 'Idempotency: same key returns same batch');

  // Cleanup test data
  await JobTitleReview.deleteMany({ batchId: batch._id });
  await JobTitleBatch.deleteOne({ _id: batch._id });
  console.log('  Test data cleaned up');

  await mongoose.disconnect();
}

(async () => {
  runParserTests();
  await runIntegrationTest();
  console.log('\n=== Done ===');
})();
