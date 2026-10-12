const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    planName: {
      type: String,
      required: true,
      unique: true
    },
    displayName: {
      type: String,
      required: true
    },
    displayNameAr: {
      type: String,
      required: true
    },
    priceMonthlyEgp: {
      type: Number,
      required: true,
      default: 50
    },
    priceEgp: {
      type: Number,
      default: 50
    },
    billingCycleDays: {
      type: Number,
      default: 30
    },
    dailySearchLimit: {
      type: Number,
      default: 15
    },
    dailyDownloadLimitPerTitle: {
      type: Number,
      default: 3
    },
    maxCandidatesPerTitle: {
      type: Number,
      default: 10
    },
    cartEnabled: {
      type: Boolean,
      default: false
    },
    platinumBrowseEnabled: {
      type: Boolean,
      default: false
    },
    searchLimitMonthly: {
      type: Number,
      default: 100
    },
    exportLimitMonthly: {
      type: Number,
      default: 20
    },
    viewLimitMonthly: {
      type: Number,
      default: 200
    },
    isActive: {
      type: Boolean,
      default: true
    },
    description: {
      type: String,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Subscription', subscriptionSchema);
