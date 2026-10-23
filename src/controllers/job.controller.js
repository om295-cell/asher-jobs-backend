const adminService = require('../services/admin.service');
const { successResponse } = require('../utils/response');
const { syncJobCatalog } = require('../seed/seed-full-catalog');

async function getJobs(req, res, next) {
  try {
    let jobs = await adminService.getAllJobs(false);

    // SEC-35: count ALL jobs (including admin-disabled ones) for the bootstrap check,
    // so a catalog where the admin deactivated all entries is NOT treated as empty.
    // This prevents the bootstrap sync from re-enabling deliberately disabled jobs.
    // SEC-28 (retained): ?refresh=true never triggers an unauthenticated sync.
    const allJobsCount = (await adminService.getAllJobs(true)).length;
    if (allJobsCount === 0) {
      console.log('[JobController] Catalog is empty – running bootstrap sync.');
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
