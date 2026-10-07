const adminService = require('../services/admin.service');
const reportService = require('../services/report.service');
const titleExtractionService = require('../services/titleExtraction.service');
const JobSuggestion = require('../models/JobSuggestion');
const { getActivityLogs } = require('../services/activity.service');
const { successResponse } = require('../utils/response');

async function getDashboard(req, res, next) {
  try {
    const metrics = await adminService.getDashboardMetrics();
    return successResponse(res, metrics, 'Admin dashboard metrics retrieved');
  } catch (err) {
    next(err);
  }
}

// Candidates
async function listCandidates(req, res, next) {
  try {
    const result = await adminService.listCandidatesForAdmin(req.query);
    return successResponse(res, result.items, 'Candidates retrieved', 200, result.pagination);
  } catch (err) {
    next(err);
  }
}

async function updateCandidate(req, res, next) {
  try {
    const candidate = await adminService.updateCandidateAdmin(req.params.id, req.body, req.user, req);
    return successResponse(res, candidate, 'Candidate updated successfully');
  } catch (err) {
    next(err);
  }
}

async function updateCandidateStatus(req, res, next) {
  try {
    const { availabilityStatus } = req.body;
    const candidate = await adminService.updateCandidateStatus(req.params.id, availabilityStatus, req.user, req);
    return successResponse(res, candidate, 'Candidate status updated');
  } catch (err) {
    next(err);
  }
}

async function toggleBlockCandidate(req, res, next) {
  try {
    const { isBlocked, blockReason } = req.body;
    const candidate = await adminService.toggleBlockCandidate(req.params.id, isBlocked, blockReason, req.user, req);
    return successResponse(res, candidate, isBlocked ? 'Candidate account blocked' : 'Candidate account unblocked');
  } catch (err) {
    next(err);
  }
}

async function deleteCandidate(req, res, next) {
  try {
    await adminService.softDeleteCandidate(req.params.id, req.user, req);
    return successResponse(res, null, 'Candidate profile deleted successfully');
  } catch (err) {
    next(err);
  }
}

// Companies
async function listCompanies(req, res, next) {
  try {
    const result = await adminService.listCompaniesForAdmin(req.query);
    return successResponse(res, result.items, 'Companies retrieved', 200, result.pagination);
  } catch (err) {
    next(err);
  }
}

async function approveCompany(req, res, next) {
  try {
    const company = await adminService.approveCompany(req.params.id, req.user, req);
    return successResponse(res, company, `Company "${company.companyName}" approved successfully.`);
  } catch (err) {
    next(err);
  }
}

async function rejectCompany(req, res, next) {
  try {
    const { reason } = req.body;
    const company = await adminService.rejectCompany(req.params.id, reason, req.user, req);
    return successResponse(res, company, `Company "${company.companyName}" marked as Rejected.`);
  } catch (err) {
    next(err);
  }
}

async function toggleBlockCompany(req, res, next) {
  try {
    const { isBlocked, blockReason } = req.body;
    const company = await adminService.toggleBlockCompany(req.params.id, isBlocked, blockReason, req.user, req);
    return successResponse(res, company, isBlocked ? 'Company blocked' : 'Company unblocked');
  } catch (err) {
    next(err);
  }
}

async function updateCompanySubscription(req, res, next) {
  try {
    const company = await adminService.updateCompanySubscription(req.params.id, req.body, req.user, req);
    return successResponse(res, company, 'Company subscription updated successfully');
  } catch (err) {
    next(err);
  }
}

// Jobs
async function listJobs(req, res, next) {
  try {
    const jobs = await adminService.getAllJobs(true);
    return successResponse(res, jobs, 'All jobs retrieved');
  } catch (err) {
    next(err);
  }
}

async function createJob(req, res, next) {
  try {
    const job = await adminService.createJob(req.body);
    return successResponse(res, job, 'Job created successfully', 201);
  } catch (err) {
    next(err);
  }
}

async function updateJob(req, res, next) {
  try {
    const job = await adminService.updateJob(req.params.id, req.body);
    return successResponse(res, job, 'Job updated successfully');
  } catch (err) {
    next(err);
  }
}

async function deleteJob(req, res, next) {
  try {
    await adminService.deleteJob(req.params.id);
    return successResponse(res, null, 'Job deleted successfully');
  } catch (err) {
    next(err);
  }
}

// Categories
async function listCategories(req, res, next) {
  try {
    const categories = await adminService.getAllCategories(true);
    return successResponse(res, categories, 'All categories retrieved');
  } catch (err) {
    next(err);
  }
}

async function createCategory(req, res, next) {
  try {
    const category = await adminService.createCategory(req.body);
    return successResponse(res, category, 'Job category created successfully', 201);
  } catch (err) {
    next(err);
  }
}

async function updateCategory(req, res, next) {
  try {
    const category = await adminService.updateCategory(req.params.id, req.body);
    return successResponse(res, category, 'Category updated successfully');
  } catch (err) {
    next(err);
  }
}

async function deleteCategory(req, res, next) {
  try {
    await adminService.deleteCategory(req.params.id);
    return successResponse(res, null, 'Category deleted successfully');
  } catch (err) {
    next(err);
  }
}

// Reports
async function listReports(req, res, next) {
  try {
    const result = await reportService.getAllReportsForAdmin(req.query);
    return successResponse(res, result.items, 'Reports retrieved', 200, result.pagination);
  } catch (err) {
    next(err);
  }
}

async function resolveReport(req, res, next) {
  try {
    const report = await reportService.resolveReport(req.params.id, req.user, req.body, req);
    return successResponse(res, report, 'Report status updated successfully');
  } catch (err) {
    next(err);
  }
}

// Activity logs
async function listActivityLogs(req, res, next) {
  try {
    const result = await getActivityLogs(req.query);
    return successResponse(res, result.items, 'Activity logs retrieved', 200, result.pagination);
  } catch (err) {
    next(err);
  }
}

// System Settings
async function getSettings(req, res, next) {
  try {
    const settings = await adminService.getSettings();
    return successResponse(res, settings, 'System settings retrieved');
  } catch (err) {
    next(err);
  }
}

async function updateSetting(req, res, next) {
  try {
    const { key, value, description } = req.body;
    const setting = await adminService.updateSetting(key, value, description);
    return successResponse(res, setting, 'System setting updated');
  } catch (err) {
    next(err);
  }
}

async function getCandidate(req, res, next) {
  try {
    const candidate = await adminService.getCandidateByIdAdmin(req.params.id);
    return successResponse(res, candidate, 'Candidate details retrieved');
  } catch (err) {
    next(err);
  }
}

async function getCompany(req, res, next) {
  try {
    const company = await adminService.getCompanyByIdAdmin(req.params.id);
    return successResponse(res, company, 'Company details retrieved');
  } catch (err) {
    next(err);
  }
}

async function listRequests(req, res, next) {
  try {
    const result = await adminService.listRecruitmentRequestsAdmin(req.query);
    return successResponse(res, result.items, 'Recruitment requests retrieved', 200, result.pagination);
  } catch (err) {
    next(err);
  }
}

async function updateRequestStatus(req, res, next) {
  try {
    const { status, notes } = req.body;
    const reqDoc = await adminService.updateRequestStatusAdmin(req.params.id, status, notes);
    return successResponse(res, reqDoc, 'Request status updated');
  } catch (err) {
    next(err);
  }
}

// ==========================================
// Job Titles Extraction & Multi-Process Save
// ==========================================

async function extractJobTitles(req, res, next) {
  try {
    const buffer = req.file?.buffer;
    const originalname = req.file?.originalname;
    const mimetype = req.file?.mimetype;
    const rawText = req.body?.text;
    const defaultCategoryId = req.body?.defaultCategoryId;

    if (!buffer && (!rawText || !rawText.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Please upload a valid file or provide text to extract job titles from.'
      });
    }

    const result = await titleExtractionService.extractTitlesForReview({
      buffer,
      originalname,
      mimetype,
      rawText,
      defaultCategoryId
    });

    return successResponse(res, result, 'Job titles extracted successfully for review');
  } catch (err) {
    console.error('[Admin] extractJobTitles error:', err.message);
    next(err);
  }
}

async function confirmSingleJobTitle(req, res, next) {
  try {
    const { name, nameAr, categoryId, description } = req.body;
    const job = await titleExtractionService.processSingleTitle({
      name,
      nameAr,
      categoryId,
      description
    });
    return successResponse(res, job, 'Job title saved successfully', 201);
  } catch (err) {
    const isDuplicate = err.message.toLowerCase().includes('duplicate');
    return res.status(isDuplicate ? 409 : 400).json({
      success: false,
      status: isDuplicate ? 'duplicate' : 'failed',
      message: err.message,
      code: isDuplicate ? 'DUPLICATE_TITLE' : 'PROCESS_FAILED'
    });
  }
}

async function batchConfirmJobTitles(req, res, next) {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Items array is required for batch title confirmation'
      });
    }

    const results = [];
    let successCount = 0;
    let duplicateCount = 0;
    let failureCount = 0;

    // Process each item as an independent, isolated process
    for (const item of items) {
      try {
        const job = await titleExtractionService.processSingleTitle(item);
        results.push({
          id: item.id,
          title: item.title || item.name || item.nameAr,
          status: 'success',
          jobId: job._id,
          job
        });
        successCount++;
      } catch (err) {
        const isDuplicate = err.message.toLowerCase().includes('duplicate');
        if (isDuplicate) {
          duplicateCount++;
          results.push({
            id: item.id,
            title: item.title || item.name || item.nameAr,
            status: 'duplicate',
            error: err.message
          });
        } else {
          failureCount++;
          results.push({
            id: item.id,
            title: item.title || item.name || item.nameAr,
            status: 'failed',
            error: err.message
          });
        }
      }
    }

    return successResponse(
      res,
      {
        summary: {
          total: items.length,
          success: successCount,
          duplicate: duplicateCount,
          failed: failureCount
        },
        results
      },
      `Processed ${items.length} titles: ${successCount} added, ${duplicateCount} duplicate, ${failureCount} failed`
    );
  } catch (err) {
    next(err);
  }
}

// Company Job Suggestions
async function listJobSuggestions(req, res, next) {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    const suggestions = await JobSuggestion.find(query)
      .populate('companyId', 'name nameAr email industry contactPhone')
      .sort({ createdAt: -1 })
      .lean();
    return successResponse(res, suggestions, 'Company job suggestions retrieved');
  } catch (err) {
    next(err);
  }
}

async function reviewJobSuggestion(req, res, next) {
  try {
    const { id } = req.params;
    const { status, categoryId, notes } = req.body; // status: 'Approved' | 'Rejected'

    const suggestion = await JobSuggestion.findById(id);
    if (!suggestion) {
      return res.status(404).json({ success: false, message: 'Suggestion not found' });
    }

    suggestion.status = status;
    if (notes) suggestion.notes = notes;
    suggestion.reviewedBy = req.user._id;
    suggestion.reviewedAt = new Date();
    await suggestion.save();

    let createdJob = null;
    if (status === 'Approved') {
      try {
        createdJob = await titleExtractionService.processSingleTitle({
          name: suggestion.proposedTitle,
          nameAr: suggestion.proposedTitle,
          categoryId: categoryId || req.body.defaultCategoryId
        });
      } catch (err) {
        console.warn('[reviewJobSuggestion] Could not create job automatically:', err.message);
      }
    }

    return successResponse(
      res,
      { suggestion, createdJob },
      `Suggestion has been marked as ${status}`
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDashboard,
  listCandidates,
  getCandidate,
  updateCandidate,
  updateCandidateStatus,
  toggleBlockCandidate,
  deleteCandidate,
  listCompanies,
  getCompany,
  approveCompany,
  rejectCompany,
  toggleBlockCompany,
  updateCompanySubscription,
  listRequests,
  updateRequestStatus,
  listJobs,
  createJob,
  updateJob,
  deleteJob,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listReports,
  resolveReport,
  listActivityLogs,
  getSettings,
  updateSetting,
  extractJobTitles,
  confirmSingleJobTitle,
  batchConfirmJobTitles,
  listJobSuggestions,
  reviewJobSuggestion
};

