const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const Company = require('../models/Company');
const SiteVisit = require('../models/SiteVisit');
const SystemSetting = require('../models/SystemSetting');

/**
 * Helper to fetch real total visitor count directly aggregated from SiteVisit
 */
async function getTotalVisitors() {
  if (mongoose.connection.readyState !== 1) {
    return 0;
  }
  try {
    const totalVisitResult = await SiteVisit.aggregate([
      { $group: { _id: null, total: { $sum: '$count' } } }
    ]);
    const realTotal = totalVisitResult[0]?.total ?? 0;
    return realTotal;
  } catch (err) {
    console.error('[stats] Error in getTotalVisitors:', err.message);
    return 0;
  }
}

let statsCache = { data: null, expiresAt: 0 };
const STATS_CACHE_TTL_MS = 30000; // 30 seconds

/**
 * GET /api/stats
 * Pure read-only endpoint returning current real counts:
 * - candidates
 * - approved companies
 * - real total site visitors
/**
 * GET /api/stats
 * Read-only endpoint returning current counts:
 * - candidates
 * - approved companies
 * - live total site visitors (always fresh)
 */
async function getStats(req, res) {
  try {
    const now = Date.now();
    const isDbConnected = mongoose.connection.readyState === 1;

    let candidateCount = 0;
    let companyCount = 0;

    if (statsCache.data && now < statsCache.expiresAt) {
      candidateCount = statsCache.data.candidates;
      companyCount = statsCache.data.companies;
    } else if (isDbConnected) {
      try {
        const [cand, comp] = await Promise.all([
          Candidate.countDocuments({ isDeleted: false, accountStatus: 'active' }),
          Company.countDocuments({ verificationStatus: 'Approved', isDeleted: false })
        ]);
        candidateCount = cand;
        companyCount = comp;
        statsCache.data = { candidates: candidateCount, companies: companyCount };
        statsCache.expiresAt = now + STATS_CACHE_TTL_MS;
      } catch (dbErr) {
        console.warn('[stats] DB query warning:', dbErr.message);
      }
    }

    // Always fetch live visitor count directly so reloading immediately shows the incremented number
    const totalVisitors = await getTotalVisitors();

    const responseData = {
      candidates: candidateCount,
      companies: companyCount,
      visitors: totalVisitors
    };

    return res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (err) {
    console.error('[stats] Error in getStats:', err.message);
    return res.status(200).json({
      success: true,
      data: {
        candidates: 0,
        companies: 0,
        visitors: 0
      }
    });
  }
}

/**
 * POST /api/stats/visit
 * Records every site visit (increments total count on each visit/reload).
 */
async function recordVisit(req, res) {
  try {
    const isDbConnected = mongoose.connection.readyState === 1;

    if (isDbConnected) {
      const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
      
      // Extract client IP address safely (supports Vercel, proxies, direct)
      const forwarded = req.headers['x-forwarded-for'];
      const clientIp = (forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress) || '127.0.0.1';

      // Increment visitor count on every visit (no deduplication)
      await SiteVisit.findOneAndUpdate(
        { date: today },
        {
          $inc: { count: 1 },
          $addToSet: { ips: clientIp }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    const realTotal = await getTotalVisitors();

    // Sync cumulative total setting in database
    if (isDbConnected) {
      await SystemSetting.findOneAndUpdate(
        { key: 'total_visitor_count' },
        { value: realTotal },
        { upsert: true }
      ).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      data: {
        visitors: realTotal
      }
    });
  } catch (err) {
    console.error('[stats] Error in recordVisit:', err.message);
    const total = await getTotalVisitors().catch(() => 0);
    return res.status(200).json({
      success: true,
      data: {
        visitors: total
      }
    });
  }
}

module.exports = { getStats, recordVisit };
