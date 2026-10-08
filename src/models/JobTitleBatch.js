const mongoose = require('mongoose');

// A batch is only a reporting/grouping unit. Every submitted title is stored
// and processed in its own JobTitleReview document.
const jobTitleBatchSchema = new mongoose.Schema(
  {
    batchNumber: { type: String, required: true, unique: true, index: true },
    source: { type: String, enum: ['manual', 'file'], required: true },
    originalFileName: { type: String, default: '' },
    // Lets a caller safely retry the same submission after a network failure.
    idempotencyKey: { type: String, trim: true, default: null },
    defaultCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobCategory', default: null },
    status: {
      type: String,
      enum: ['Processing', 'Completed', 'Completed with Errors', 'Failed'],
      default: 'Processing',
      index: true
    },
    totalTitles: { type: Number, default: 0 },
    pendingReviewCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    approvedCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

jobTitleBatchSchema.index({ createdAt: -1 });
jobTitleBatchSchema.index(
  { createdBy: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

module.exports = mongoose.model('JobTitleBatch', jobTitleBatchSchema);
