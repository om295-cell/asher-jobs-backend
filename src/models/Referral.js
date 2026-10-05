const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema(
  {
    referrerCandidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
      index: true
    },
    referredCandidateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Candidate',
      required: true,
      unique: true,
      index: true
    },
    referralCode: {
      type: String,
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['Registered', 'ProfileCompleted', 'Contacted', 'Hired'],
      default: 'Registered'
    },
    registeredAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Referral', referralSchema);
