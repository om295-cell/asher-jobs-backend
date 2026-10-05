const Candidate = require('../models/Candidate');
const Company = require('../models/Company');
const SiteVisit = require('../models/SiteVisit');
const SystemSetting = require('../models/SystemSetting');

/**
 * Helper to fetch total visitor count from SystemSetting or aggregate from SiteVisit
 */
async function getTotalVisitors() {
  const setting = await SystemSetting.findOne({ key: 'total_visitor_count' }).lean();
  if (setting && typeof setting.value === 'number') {
    return setting.value;
  }
  const totalVisitResult = await SiteVisit.aggregate([
    { $group: { _id: null, total: { $sum: '$count' } } }
  ]);
  return totalVisitResult[0]?.total || 1;
}

/**
 * GET /api/stats
 * Pure read-only endpoint returning current counts:
 * - candidates
 * - approved companies
 * - total site visitors
 * Safe to call repeatedly without unwanted side-effects.
 */
async function getStats(req, res) {
  try {
    const [candidateCount, companyCount, totalVisitors] = await Promise.all([
      Candidate.countDocuments({ isDeleted: false, accountStatus: 'active' }),
      Company.countDocuments({ verificationStatus: 'Approved', isDeleted: false }),
      getTotalVisitors()
    ]);

    return res.status(200).json({
      success: true,
      data: {
        candidates: candidateCount,
        companies: companyCount,
        visitors: totalVisitors
      }
    });
  } catch (err) {
    console.error('[stats] Error in getStats:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load stats' });
  }
}

/**
 * POST /api/stats/visit
 * Records a visitor session and increments both:
 * 1. Persistent cumulative total in SystemSetting
 * 2. Daily bucket in SiteVisit
 */
async function recordVisit(req, res) {
  try {
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

    // Increment cumulative total
    const updatedSetting = await SystemSetting.findOneAndUpdate(
      { key: 'total_visitor_count' },
      { $inc: { value: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Increment daily bucket
    await SiteVisit.findOneAndUpdate(
      { date: today },
      { $inc: { count: 1 } },
      { upsert: true }
    );

    const visitors = updatedSetting?.value ?? 1;

    return res.status(200).json({
      success: true,
      data: {
        visitors
      }
    });
  } catch (err) {
    console.error('[stats] Error in recordVisit:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to record visit' });
  }
}

module.exports = { getStats, recordVisit };
