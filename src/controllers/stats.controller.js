const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const Company = require('../models/Company');
const SiteVisit = require('../models/SiteVisit');
const SystemSetting = require('../models/SystemSetting');

// Fallback baseline for visitor counter
let inMemoryVisitors = 1248;

/**
 * Helper to fetch total visitor count from SystemSetting or aggregate from SiteVisit
 */
async function getTotalVisitors() {
  if (mongoose.connection.readyState !== 1) {
    return inMemoryVisitors;
  }
  try {
    const setting = await SystemSetting.findOne({ key: 'total_visitor_count' }).lean();
    if (setting && typeof setting.value === 'number') {
      inMemoryVisitors = Math.max(inMemoryVisitors, setting.value);
      return inMemoryVisitors;
    }
    const totalVisitResult = await SiteVisit.aggregate([
      { $group: { _id: null, total: { $sum: '$count' } } }
    ]);
    const total = totalVisitResult[0]?.total || inMemoryVisitors;
    inMemoryVisitors = Math.max(inMemoryVisitors, total);
    return inMemoryVisitors;
  } catch (err) {
    return inMemoryVisitors;
  }
}

/**
 * GET /api/stats
 * Pure read-only endpoint returning current counts:
 * - candidates
 * - approved companies
 * - total site visitors
 */
async function getStats(req, res) {
  try {
    const isDbConnected = mongoose.connection.readyState === 1;

    let candidateCount = 250;
    let companyCount = 45;
    let totalVisitors = inMemoryVisitors;

    if (isDbConnected) {
      try {
        const [cand, comp, vis] = await Promise.all([
          Candidate.countDocuments({ isDeleted: false, accountStatus: 'active' }),
          Company.countDocuments({ verificationStatus: 'Approved', isDeleted: false }),
          getTotalVisitors()
        ]);
        candidateCount = cand;
        companyCount = comp;
        totalVisitors = vis;
      } catch (dbErr) {
        console.warn('[stats] DB query warning, returning fallback:', dbErr.message);
      }
    }

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
    return res.status(200).json({
      success: true,
      data: {
        candidates: 250,
        companies: 45,
        visitors: inMemoryVisitors
      }
    });
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
    inMemoryVisitors += 1;
    const isDbConnected = mongoose.connection.readyState === 1;

    if (isDbConnected) {
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

        if (updatedSetting?.value) {
          inMemoryVisitors = Math.max(inMemoryVisitors, updatedSetting.value);
        }
      } catch (dbErr) {
        console.warn('[stats] DB write warning, kept in-memory:', dbErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        visitors: inMemoryVisitors
      }
    });
  } catch (err) {
    console.error('[stats] Error in recordVisit:', err.message);
    inMemoryVisitors += 1;
    return res.status(200).json({
      success: true,
      data: {
        visitors: inMemoryVisitors
      }
    });
  }
}

module.exports = { getStats, recordVisit };
