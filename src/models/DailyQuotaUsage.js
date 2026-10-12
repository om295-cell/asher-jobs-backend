const mongoose = require('mongoose');

const dailyQuotaUsageSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },
    // Calendar date formatted as YYYY-MM-DD in Africa/Cairo timezone
    cairoDate: {
      type: String,
      required: true,
      index: true
    },
    // Total job-title searches performed today
    searchesCount: {
      type: Number,
      default: 0
    },
    // Map of jobId -> count of Excel downloads for that title today
    downloadsByJob: {
      type: Map,
      of: Number,
      default: {}
    },
    // Single-record views through dedicated Platinum browsing page
    platinumViews: [
      {
        candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' },
        viewedAt: { type: Date, default: Date.now }
      }
    ],
    // Single-record downloads through dedicated Platinum browsing page
    platinumDownloads: [
      {
        candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate' },
        downloadedAt: { type: Date, default: Date.now }
      }
    ],
    // Count of multi-title cart exports
    cartExportsCount: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// One daily usage record per company per calendar day
dailyQuotaUsageSchema.index({ companyId: 1, cairoDate: 1 }, { unique: true });

module.exports = mongoose.model('DailyQuotaUsage', dailyQuotaUsageSchema);
