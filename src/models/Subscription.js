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
