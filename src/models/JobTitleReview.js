const mongoose = require('mongoose');

const jobTitleReviewSchema = new mongoose.Schema(
  {
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobTitleBatch', required: true, index: true },
    sequence: { type: Number, required: true },
    source: { type: String, enum: ['manual', 'file'], required: true },
    originalTitle: { type: String, required: true, trim: true },
    finalTitle: { type: String, default: '', trim: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JobCategory', default: null },
    status: {
      type: String,
      enum: ['Pending Review', 'Processing', 'Approved', 'Edited', 'Rejected', 'Failed'],
      default: 'Processing',
      index: true
    },
    errorMessage: { type: String, default: '' },
    rejectionReason: { type: String, default: '' },
    createdJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },
    retryCount: { type: Number, default: 0 },
    isArchived: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);

jobTitleReviewSchema.index({ batchId: 1, sequence: 1 }, { unique: true });
jobTitleReviewSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('JobTitleReview', jobTitleReviewSchema);
