const mongoose = require('mongoose');

const CAREER_LEVELS = [
  'مبتدئ (1-3 سنوات)',
  'متوسط (3-5 سنوات)',
  'متقدم (5-7 سنوات)',
  'صاحب خبره كبيره (أكثر من 7 سنوات)'
];

const personTitleSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true
    },
    jobTitle: {
      type: String,
      default: ''
    },
    jobTitleAr: {
      type: String,
      default: ''
    },
    careerLevel: {
      type: String,
      required: true,
      enum: CAREER_LEVELS
    },
    priority: {
      type: Number,
      default: 1
    }
  },
  { _id: false }
);

const personSchema = new mongoose.Schema(
  {
    isPrimary: {
      type: Boolean,
      default: false
    },
    role: {
      type: String,
      enum: ['submitter', 'recommendation'],
      default: 'recommendation'
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
    },
    phoneNormalized: {
      type: String,
      required: true,
      trim: true
    },
    // Primary / 1st title (kept for backward compatibility)
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true
    },
    jobTitle: {
      type: String,
      default: ''
    },
    jobTitleAr: {
      type: String,
      default: ''
    },
    careerLevel: {
      type: String,
      required: true,
      enum: CAREER_LEVELS
    },
    // Up to 3 titles for each person, each with their own career level & priority (1, 2, 3)
    titles: {
      type: [personTitleSchema],
      default: []
    }
  },
  { _id: true }
);

const recommendationRequestSchema = new mongoose.Schema(
  {
    requestNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    status: {
      type: String,
      enum: ['pending', 'phone_duplicate_pending', 'approved', 'partially_approved', 'rejected'],
      default: 'pending',
      index: true
    },
    legalAccepted: {
      type: Boolean,
      required: true,
      default: false
    },
    submitterIp: {
      type: String,
      default: ''
    },
    submitterUserAgent: {
      type: String,
      default: ''
    },
    adminNotes: {
      type: String,
      default: ''
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: {
      type: Date
    },
    // Chain linking (when a previously recommended person submits as main)
    isChainLinked: {
      type: Boolean,
      default: false,
      index: true
    },
    chainParentRequestNumber: {
      type: String,
      default: null,
      index: true
    },
    chainParentSubmitterName: {
      type: String,
      default: null
    },
    chainParentSubmitterPhone: {
      type: String,
      default: null
    },
    chainChildrenRequestNumbers: {
      type: [String],
      default: []
    },
    // Phone conflict (when 2 different names submit the same phone)
    hasPhoneConflict: {
      type: Boolean,
      default: false,
      index: true
    },
    phoneConflictStatus: {
      type: String,
      enum: ['none', 'pending_investigation', 'approved_both', 'rejected_main_kept_recommendations', 'rejected_whole'],
      default: 'none',
      index: true
    },
    phoneConflictDetails: {
      conflictingPhone: { type: String, default: null },
      firstRequestNumber: { type: String, default: null },
      firstSubmitterName: { type: String, default: null },
      secondRequestNumber: { type: String, default: null },
      secondSubmitterName: { type: String, default: null },
      resolvedAt: { type: Date, default: null },
      resolutionAction: { type: String, default: null },
      resolutionNotes: { type: String, default: null }
    },
    // Submitter rejection logging when recommendations are kept
    rejectedSubmitterName: {
      type: String,
      default: null
    },
    rejectedSubmitterPhone: {
      type: String,
      default: null
    },
    recommendationsOnlyApproved: {
      type: Boolean,
      default: false
    },
    // Array of exactly 11 people: index 0 is primary submitter, 1-10 are recommendations
    people: {
      type: [personSchema],
      validate: {
        validator: function (v) {
          return Array.isArray(v) && v.length === 11;
        },
        message: 'A recommendation request must contain exactly 11 people (1 submitter + 10 recommendations).'
      }
    }
  },
  {
    timestamps: true
  }
);

// Indexes for fast lookup
recommendationRequestSchema.index({ 'people.phoneNormalized': 1 });
recommendationRequestSchema.index({ status: 1, createdAt: -1 });
recommendationRequestSchema.index({ hasPhoneConflict: 1, phoneConflictStatus: 1 });
recommendationRequestSchema.index({ isChainLinked: 1, createdAt: -1 });

module.exports = {
  RecommendationRequest: mongoose.model('RecommendationRequest', recommendationRequestSchema),
  CAREER_LEVELS
};
