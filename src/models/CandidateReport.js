const mongoose = require('mongoose');

const candidateReportSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },
    candidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
      index: true
    },
    type: {
      type: String,
      enum: [
        'INCORRECT_PHONE',
        'OUTDATED_INFO',
        'NOT_AVAILABLE',
        'DUPLICATE_CANDIDATE',
        'INAPPROPRIATE_CONTENT',
        'OTHER'
      ],
      required: true
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['Open', 'Under Review', 'Resolved', 'Rejected'],
      default: 'Open',
      index: true
    },
    adminNotes: {
      type: String,
      default: ''
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    resolvedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('CandidateReport', candidateReportSchema);
