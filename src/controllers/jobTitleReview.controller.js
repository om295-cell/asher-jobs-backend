const service = require('../services/jobTitleReview.service');
const { successResponse } = require('../utils/response');

async function createManualBatch(req, res, next) {
  try {
    const batch = await service.createManualBatch({ ...req.body, actor: req.user, req });
    return successResponse(res, batch, 'Job-title review batch created.', 201);
  } catch (error) { next(error); }
}

async function createFileBatch(req, res, next) {
  try {
    const batch = await service.createFileBatch({ file: req.file, categoryId: req.body.categoryId, idempotencyKey: req.body.idempotencyKey, actor: req.user, req });
    return successResponse(res, batch, 'Job-title file imported into the review queue.', 201);
  } catch (error) { next(error); }
}

async function listBatches(req, res, next) {
  try {
    const result = await service.listBatches(req.query);
    return successResponse(res, result.items, 'Job-title batches retrieved.', 200, result.pagination);
  } catch (error) { next(error); }
}

async function getBatch(req, res, next) {
  try { return successResponse(res, await service.getBatchById(req.params.id), 'Job-title batch retrieved.'); } catch (error) { next(error); }
}

async function listReviews(req, res, next) {
  try {
    const result = await service.listReviews(req.query);
    return successResponse(res, result.items, 'Job-title review records retrieved.', 200, result.pagination);
  } catch (error) { next(error); }
}

async function getReview(req, res, next) {
  try { return successResponse(res, await service.getReviewById(req.params.id), 'Job-title review record retrieved.'); } catch (error) { next(error); }
}

async function editReview(req, res, next) {
  try { return successResponse(res, await service.editReview(req.params.id, req.body, req.user, req), 'Job title updated for review.'); } catch (error) { next(error); }
}

async function approveReview(req, res, next) {
  try { return successResponse(res, await service.approveReview(req.params.id, req.body, req.user, req), 'Job-title approval processed.'); } catch (error) { next(error); }
}

async function rejectReview(req, res, next) {
  try { return successResponse(res, await service.rejectReview(req.params.id, req.body.reason, req.user, req), 'Job title rejected.'); } catch (error) { next(error); }
}

async function retryReview(req, res, next) {
  try { return successResponse(res, await service.retryReview(req.params.id, req.user, req), 'Job-title retry processed.'); } catch (error) { next(error); }
}

async function bulkRejectReviews(req, res, next) {
  try {
    const result = await service.bulkRejectReviews({ reason: req.body.reason, batchId: req.body.batchId, actor: req.user, req });
    return successResponse(res, result, 'Bulk rejection completed.');
  } catch (error) { next(error); }
}

async function deleteArchivedReview(req, res, next) {
  try {
    await service.deleteArchivedReview(req.params.id, req.user, req);
    return successResponse(res, null, 'Archived record permanently deleted.');
  } catch (error) { next(error); }
}

async function deleteAllArchivedReviews(req, res, next) {
  try {
    const result = await service.deleteAllArchivedReviews({ batchId: req.query.batchId, actor: req.user, req });
    return successResponse(res, result, 'All archived records permanently deleted.');
  } catch (error) { next(error); }
}

module.exports = { createManualBatch, createFileBatch, listBatches, getBatch, listReviews, getReview, editReview, approveReview, rejectReview, retryReview, bulkRejectReviews, deleteArchivedReview, deleteAllArchivedReviews };
