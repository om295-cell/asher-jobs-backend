const adminService = require('../services/admin.service');
const { successResponse } = require('../utils/response');
const { syncJobCatalog } = require('../seed/seed-full-catalog');

async function getJobs(req, res, next) {
  try {
    let jobs = await adminService.getAllJobs(false);

    // Trigger sync ONLY if DB is empty or explicitly requested via ?refresh=true
    const needsSync = jobs.length === 0 || req.query.refresh === 'true';
    if (needsSync) {
      console.log(`[JobController] Catalog sync triggered (total jobs: ${jobs.length}). Synchronizing...`);
      await syncJobCatalog();
      adminService.invalidateCatalogueCache();
      jobs = await adminService.getAllJobs(false);
    }

    return successResponse(res, jobs, 'Active jobs retrieved');
  } catch (err) {
    next(err);
  }
}

async function getCategories(req, res, next) {
  try {
    const categories = await adminService.getAllCategories(false);
    return successResponse(res, categories, 'Active categories retrieved');
  } catch (err) {
    next(err);
  }
}

async function syncCatalog(req, res, next) {
  try {
    const result = await syncJobCatalog();
    adminService.invalidateCatalogueCache();
    const jobs = await adminService.getAllJobs(false);
    return successResponse(res, { result, totalJobs: jobs.length }, 'Catalog synchronized successfully');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getJobs,
  getCategories,
  syncCatalog
};
