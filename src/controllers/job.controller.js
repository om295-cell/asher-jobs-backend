const adminService = require('../services/admin.service');
const { successResponse } = require('../utils/response');
const { syncJobCatalog } = require('../seed/seed-full-catalog');

async function getJobs(req, res, next) {
  try {
    let jobs = await adminService.getAllJobs(false);

    // Trigger sync if: no jobs exist (empty/fresh DB), >30 accounting jobs (legacy dump), or manual refresh
    const accountingJobs = jobs.filter(
      (j) => j.categoryId?.nameAr === 'محاسبة ومالية' || j.categoryId?.name === 'Accounting & Finance'
    );
    const needsSync = jobs.length === 0 || accountingJobs.length > 30 || req.query.refresh === 'true';
    if (needsSync) {
      console.log(`[JobController] Catalog sync triggered (total jobs: ${jobs.length}, accounting: ${accountingJobs.length}). Synchronizing...`);
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
