const mongoose = require('mongoose');

const candidateInteractionSchema = new mongoose.Schema(
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
    recruitmentRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RecruitmentRequest'
    },
    action: {
      type: String,
      enum: [
        'CALL_CLICKED',
        'WHATSAPP_CLICKED',
        'CV_REQUESTED',
        'PROFILE_VIEWED',
        'CONTACTED',
        'INTERVIEW_SCHEDULED',
        'HIRED',
        'REJECTED'
      ],
      required: true
    },
    notes: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

candidateInteractionSchema.index({ companyId: 1, candidateId: 1 });

module.exports = mongoose.model('CandidateInteraction', candidateInteractionSchema);
