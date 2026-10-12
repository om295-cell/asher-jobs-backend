const mongoose = require('mongoose');

const candidateCartItemSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 10,
      default: 1
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    }
  },
  { _id: true }
);

const candidateCartSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      unique: true,
      index: true
    },
    items: [candidateCartItemSchema]
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('CandidateCart', candidateCartSchema);
