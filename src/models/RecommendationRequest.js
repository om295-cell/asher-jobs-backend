const mongoose = require('mongoose');

const CAREER_LEVELS = [
  'مبتدئ (1-3 سنوات)',
  'متوسط (3-5 سنوات)',
  'متقدم (5-7 سنوات)',
  'صاحب خبره كبيره (أكثر من 7 سنوات)'
];

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
      enum: ['pending', 'approved', 'rejected'],
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

module.exports = {
  RecommendationRequest: mongoose.model('RecommendationRequest', recommendationRequestSchema),
  CAREER_LEVELS
};
