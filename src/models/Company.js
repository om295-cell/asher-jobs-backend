const mongoose = require('mongoose');

const companySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    companyName: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },
    phone: {
      type: String,
      required: true,
      trim: true
    },
    phoneNormalized: {
      type: String,
      trim: true
    },
    address: {
      type: String,
      trim: true,
      default: ''
    },
    governorate: {
      type: String,
      trim: true,
      default: 'Sharqia'
    },
    area: {
      type: String,
      trim: true,
      default: '10th of Ramadan'
    },
    industry: {
      type: String,
      trim: true,
      default: 'Industrial & Manufacturing'
    },
    website: {
      type: String,
      trim: true,
      default: ''
    },
    contactPerson: {
      type: String,
      trim: true,
      default: ''
    },
    contactPersonPhone: {
      type: String,
      trim: true,
      default: ''
    },
    verificationStatus: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected', 'Suspended', 'Blocked'],
      default: 'Pending',
      index: true
    },
    rejectionReason: {
      type: String,
      default: ''
    },
    approvedAt: {
      type: Date
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    subscriptionStatus: {
      type: String,
      enum: ['active', 'inactive', 'expired'],
      default: 'active',
      index: true
    },
    subscriptionPlan: {
      type: String,
      enum: ['Free', 'Basic', 'Custom'],
      default: 'Basic'
    },
    subscriptionStartDate: {
      type: Date,
      default: Date.now
    },
    subscriptionEndDate: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    },
    monthlyPriceEgp: {
      type: Number,
      default: 50
    },
    searchesUsed: {
      type: Number,
      default: 0
    },
    searchLimit: {
      type: Number,
      default: 100
    },
    exportsUsed: {
      type: Number,
      default: 0
    },
    exportLimit: {
      type: Number,
      default: 20
    },
    viewsUsed: {
      type: Number,
      default: 0
    },
    viewLimit: {
      type: Number,
      default: 200
    },
    isBlocked: {
      type: Boolean,
      default: false,
      index: true
    },
    blockReason: {
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

companySchema.index({ verificationStatus: 1, subscriptionStatus: 1, isBlocked: 1 });

module.exports = mongoose.model('Company', companySchema);
