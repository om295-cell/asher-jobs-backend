const mongoose = require('mongoose');

const recruitmentRequestSchema = new mongoose.Schema(
  {
    requestNumber: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      index: true
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobCategory'
    },
    quantityRequested: {
      type: Number,
      required: true,
      min: 1
    },
    filters: {
      governorate: String,
      area: String,
      minExperience: Number,
      maxExperience: Number,
      qualification: String,
      availabilityStatus: String
    },
    notes: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['Pending', 'Processing', 'Completed', 'Cancelled', 'Closed'],
      default: 'Completed'
    },
    candidatesReturned: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Candidate'
      }
    ],
    candidatesSelected: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Candidate'
      }
    ]
  },
  {
    timestamps: true
  }
);

recruitmentRequestSchema.index({ companyId: 1, createdAt: -1 });

module.exports = mongoose.model('RecruitmentRequest', recruitmentRequestSchema);
