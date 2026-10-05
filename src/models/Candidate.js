const mongoose = require('mongoose');

const candidateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
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
      unique: true,
      trim: true,
      index: true
    },
    email: {
      type: String,
      lowercase: true,
      trim: true
    },
    desiredJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      index: true
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobCategory',
      index: true
    },
    governorate: {
      type: String,
      trim: true,
      default: 'Sharqia',
      index: true
    },
    area: {
      type: String,
      trim: true,
      default: '10th of Ramadan',
      index: true
    },
    yearsOfExperience: {
      type: Number,
      default: 0,
      min: 0,
      index: true
    },
    qualification: {
      type: String,
      trim: true,
      default: 'Technical Diploma'
    },
    skills: {
      type: [String],
      default: []
    },
    availabilityStatus: {
      type: String,
      enum: ['Available', 'Contacted', 'Interviewing', 'Hired', 'Not Available'],
      default: 'Available',
      index: true
    },
    cvUrl: {
      type: String,
      default: null
    },
    cvOriginalName: {
      type: String,
      default: null
    },
    cvMimeType: {
      type: String,
      default: null
    },
    cvSize: {
      type: Number,
      default: 0
    },
    cvUploadedAt: {
      type: Date
    },
    consentGiven: {
      type: Boolean,
      required: true,
      default: false
    },
    consentDate: {
      type: Date,
      default: Date.now
    },
    consentVersion: {
      type: String,
      default: '1.0'
    },
    profileStatus: {
      type: String,
      enum: ['Complete', 'Incomplete'],
      default: 'Complete'
    },
    accountStatus: {
      type: String,
      enum: ['active', 'deactivated', 'blocked'],
      default: 'active',
      index: true
    },
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Candidate',
      index: true
    },
    referralCount: {
      type: Number,
      default: 0
    },
    adminNotes: {
      type: String,
      default: ''
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true
    },
    deletedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for high-speed recruitment search
candidateSchema.index({ desiredJobId: 1, availabilityStatus: 1, governorate: 1 });
candidateSchema.index({ categoryId: 1, availabilityStatus: 1 });
candidateSchema.index({ availabilityStatus: 1, accountStatus: 1, isDeleted: 1 });

module.exports = mongoose.model('Candidate', candidateSchema);
