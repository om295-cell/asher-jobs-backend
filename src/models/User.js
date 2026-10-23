const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
      index: true
    },
    phone: {
      type: String,
      trim: true
    },
    phoneNormalized: {
      type: String,
      trim: true,
      index: true
    },
    passwordHash: {
      type: String,
      required: true,
      select: false
    },
    role: {
      type: String,
      enum: ['admin', 'company', 'candidate'],
      required: true,
      default: 'candidate'
    },
    isBlocked: {
      type: Boolean,
      default: false
    },
    blockReason: {
      type: String,
      default: ''
    },
    accountStatus: {
      type: String,
      enum: ['active', 'pending', 'suspended', 'deactivated'],
      default: 'active'
    },
    accountType: {
      type: String,
      enum: ['company', 'individual_hr', 'candidate'],
      default: 'candidate'
    },
    mustChangePassword: {
      type: Boolean,
      default: false,
      index: true
    },
    loginFailedCount: {
      type: Number,
      default: 0
    },
    loginLockedUntil: {
      type: Date,
      default: null
    },
    lastLoginAt: {
      type: Date
    },
    tokenVersion: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

userSchema.index({ role: 1 });

module.exports = mongoose.model('User', userSchema);
