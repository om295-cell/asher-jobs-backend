const assert = require('assert');
const JobTitleBatch = require('./src/models/JobTitleBatch');
const JobTitleReview = require('./src/models/JobTitleReview');
const { parseLinesFromRawText } = require('./src/services/titleExtraction.service');
const { runIndependently } = require('./src/services/jobTitleReview.service');

async function main() {
  // Manual input is split into independent title candidates.
  assert.deepStrictEqual(
    parseLinesFromRawText('Electrician\nMachine operator\nQuality inspector'),
    ['Electrician', 'Machine operator', 'Quality inspector']
  );

  // Persisted lifecycle schemas contain the required individual title and batch states.
  const reviewStates = JobTitleReview.schema.path('status').enumValues;
  ['Pending Review', 'Processing', 'Approved', 'Edited', 'Rejected', 'Failed'].forEach((state) => assert(reviewStates.includes(state)));
  const batchStates = JobTitleBatch.schema.path('status').enumValues;
  ['Processing', 'Completed', 'Completed with Errors', 'Failed'].forEach((state) => assert(batchStates.includes(state)));
  assert(JobTitleReview.schema.path('originalTitle'));
  assert(JobTitleReview.schema.path('finalTitle'));
  assert(JobTitleReview.schema.path('errorMessage'));

  // Failure isolation: item 2 fails, but 1 and 3 still run. This deliberately
  // tests the worker used by imports without requiring a database server.
  const processed = [];
  const failed = [];
  await runIndependently(
    ['1', '2', '3'],
    1,
    async (id) => {
      if (id === '2') throw new Error('Bad title');
      processed.push(id);
    },
    async (id, error) => failed.push({ id, message: error.message })
  );
  assert.deepStrictEqual(processed, ['1', '3']);
  assert.deepStrictEqual(failed, [{ id: '2', message: 'Bad title' }]);
  console.log('Job title review tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
