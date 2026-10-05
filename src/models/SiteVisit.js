const mongoose = require('mongoose');

const siteVisitSchema = new mongoose.Schema(
  {
    // Daily bucketing: one doc per date, incremented atomically
    date: {
      type: String, // 'YYYY-MM-DD'
      required: true,
      unique: true,
      index: true
    },
    count: {
      type: Number,
      default: 0
    },
    // Unique IPs seen today — used to deduplicate visitor counts
    ips: {
      type: [String],
      default: []
    }
  },
  { timestamps: false }
);

module.exports = mongoose.model('SiteVisit', siteVisitSchema);
