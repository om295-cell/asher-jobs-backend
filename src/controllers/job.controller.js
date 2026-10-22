const adminService = require('../services/admin.service');
const { successResponse } = require('../utils/response');
const { syncJobCatalog } = require('../seed/seed-full-catalog');

async function getJobs(req, res, next) {
  try {
    let jobs = await adminService.getAllJobs(false);

    // If database still contains the legacy unclassified accounting dump (> 30 jobs in accounting) or manual refresh requested
    const accountingJobs = jobs.filter(
      (j) => j.categoryId?.nameAr === 'محاسبة ومالية' || j.categoryId?.name === 'Accounting & Finance'
    );
    if (accountingJobs.length > 30 || req.query.refresh === 'true') {
      console.log(`[JobController] Detected ${accountingJobs.length} jobs in Accounting. Running full catalog synchronization...`);
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
