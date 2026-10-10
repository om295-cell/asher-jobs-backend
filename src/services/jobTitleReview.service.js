const Job = require('../models/Job');
const JobCategory = require('../models/JobCategory');
const JobTitleBatch = require('../models/JobTitleBatch');
const JobTitleReview = require('../models/JobTitleReview');
const { getPagination, formatPagination } = require('../utils/pagination');
const { parseLinesFromRawText, extractLinesFromFile, normalizeForComparison } = require('./titleExtraction.service');
const { processSingleTitle } = require('./titleExtraction.service');
const { getCategoryCache, resolveCategoryForTitle } = require('./categoryInference.service');
const { logActivity } = require('./activity.service');

function makeBatchNumber() {
  return `JTB-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;
}

function cleanTitle(title) {
  return typeof title === 'string' ? title.trim().replace(/\s+/g, ' ') : '';
}

async function getOrCreateUncategorizedCategory() {
  // An import never stops just because an admin has not classified it yet.
  // This category remains editable through the existing Categories screen.
  let category = await JobCategory.findOne({ name: 'Uncategorized' });
  if (!category) {
    try {
      category = await JobCategory.create({
        name: 'Uncategorized',
        nameAr: 'غير مصنف',
        description: 'Automatically created for job titles awaiting categorization.',
        isActive: true,
        systemGenerated: true
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      category = await JobCategory.findOne({ name: 'Uncategorized' });
    }
  }
  return category;
}

async function ensureCategory(categoryId) {
  if (!categoryId) return getOrCreateUncategorizedCategory();
  const category = await JobCategory.findById(categoryId);
  if (!category) {
    throw { statusCode: 400, code: 'INVALID_CATEGORY', message: 'The selected job category does not exist.' };
  }
  return category;
}

async function refreshBatch(batchId) {
  const counts = await JobTitleReview.aggregate([
    { $match: { batchId } },
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);
  const byStatus = Object.fromEntries(counts.map((entry) => [entry._id, entry.count]));
  const totalTitles = Object.values(byStatus).reduce((total, count) => total + count, 0);
  const pendingReviewCount = (byStatus['Pending Review'] || 0) + (byStatus.Edited || 0);
  const failedCount = byStatus.Failed || 0;
  const approvedCount = byStatus.Approved || 0;
  const processingCount = byStatus.Processing || 0;
  let status = 'Processing';
  if (processingCount === 0) {
    status = totalTitles === 0 || failedCount === totalTitles
      ? 'Failed'
      : failedCount > 0
        ? 'Completed with Errors'
        : 'Completed';
  }
  return JobTitleBatch.findByIdAndUpdate(
    batchId,
    { totalTitles, pendingReviewCount, failedCount, approvedCount, status, completedAt: processingCount === 0 ? new Date() : null },
    { new: true }
  );
}

async function titleAlreadyExists(title, review) {
  const normalized = normalizeForComparison(title);
  if (!normalized) return 'A job title is required.';
  const jobs = await Job.find({}).select('name nameAr').lean();
  if (jobs.some((job) => normalizeForComparison(job.name) === normalized || normalizeForComparison(job.nameAr) === normalized)) {
    return 'A matching job title already exists in the approved catalog.';
  }
  // For entries in the same batch, only an earlier sequence owns the title.
  // That deterministic rule means a duplicate line fails independently while
  // its first occurrence still reaches review, even when workers run in parallel.
  const query = {
    _id: { $ne: review._id },
    status: { $in: ['Pending Review', 'Processing', 'Edited', 'Approved'] },
    $or: [
      { batchId: { $ne: review.batchId } },
      { batchId: review.batchId, sequence: { $lt: review.sequence } }
    ]
  };
  const reviews = await JobTitleReview.find(query).select('originalTitle finalTitle').lean();
  if (reviews.some((review) => normalizeForComparison(review.finalTitle || review.originalTitle) === normalized)) {
    return 'This title already exists in another submitted title record.';
  }
  return null;
}

async function prepareOneReview(reviewId) {
  const review = await JobTitleReview.findById(reviewId);
  if (!review) return null;

  const title = cleanTitle(review.finalTitle || review.originalTitle);
  let errorMessage = '';
  if (!title || title.length < 2 || title.length > 120) {
    errorMessage = 'Job title must contain between 2 and 120 characters.';
  } else if (!review.categoryId) {
    errorMessage = 'A job category must be selected before review.';
  } else {
    const category = await JobCategory.exists({ _id: review.categoryId });
    if (!category) errorMessage = 'The selected job category no longer exists.';
  }
  if (!errorMessage) errorMessage = await titleAlreadyExists(title, review);

  review.finalTitle = title;
  review.errorMessage = errorMessage || '';
  review.status = errorMessage ? 'Failed' : 'Pending Review';
  await review.save();
  return review;
}

async function runIndependently(
  reviewIds,
  concurrency = 8,
  processor = prepareOneReview,
  onError = async (reviewId, error) => JobTitleReview.findByIdAndUpdate(reviewId, {
    status: 'Failed',
    errorMessage: error.message || 'Unable to process this job title.'
  })
) {
  let cursor = 0;
  async function worker() {
    while (cursor < reviewIds.length) {
      const reviewId = reviewIds[cursor++];
      try {
        await processor(reviewId);
      } catch (error) {
        // This catch only changes the failed item: no batch transaction or rollback is used.
        await onError(reviewId, error);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, reviewIds.length) }, worker));
}

async function createBatch({ titles, source, categoryId, originalFileName = '', idempotencyKey = '', actor, req }) {
  if (idempotencyKey) {
    const existing = await JobTitleBatch.findOne({ createdBy: actor._id, idempotencyKey }).lean();
    if (existing) return getBatchById(existing._id);
  }
  const category = await ensureCategory(categoryId);
  const resolvedCategoryId = category._id;
  const cleanedTitles = titles.map(cleanTitle).filter(Boolean);
  if (!cleanedTitles.length) {
    throw { statusCode: 400, code: 'NO_TITLES_FOUND', message: 'لم يتم العثور على مسميات وظيفية صالحة في المدخلات.' };
  }
  if (cleanedTitles.length > 5000) {
    throw { statusCode: 400, code: 'TOO_MANY_TITLES', message: 'A batch can contain at most 5,000 job titles.' };
  }

  const batch = await JobTitleBatch.create({
    batchNumber: makeBatchNumber(),
    source,
    originalFileName,
    idempotencyKey: idempotencyKey || null,
    defaultCategoryId: resolvedCategoryId,
    totalTitles: cleanedTitles.length,
    createdBy: actor._id
  });

  // Batch check duplicates and validation upfront in memory (O(1)) instead of
  // hundreds of round-trips over the network that timeout on serverless platforms.
  const [existingJobs, existingReviews, categoryCache] = await Promise.all([
    Job.find({}).select('name nameAr').lean(),
    JobTitleReview.find({ status: { $in: ['Pending Review', 'Processing', 'Edited', 'Approved'] } })
      .select('originalTitle finalTitle')
      .lean(),
    getCategoryCache()
  ]);

  const existingCatalogSet = new Set(
    existingJobs.flatMap((j) => [normalizeForComparison(j.name), normalizeForComparison(j.nameAr)]).filter(Boolean)
  );

  const existingReviewsSet = new Set(
    existingReviews.flatMap((r) => [normalizeForComparison(r.finalTitle), normalizeForComparison(r.originalTitle)]).filter(Boolean)
  );

  const seenInCurrentBatch = new Set();
  const docsToInsert = [];

  for (let index = 0; index < cleanedTitles.length; index++) {
    const originalTitle = cleanedTitles[index];
    const title = cleanTitle(originalTitle);
    const normalized = normalizeForComparison(title);
    let errorMessage = '';

    if (!title || title.length < 2 || title.length > 120) {
      errorMessage = 'Job title must contain between 2 and 120 characters.';
    } else if (!normalized) {
      errorMessage = 'A job title is required.';
    } else if (existingCatalogSet.has(normalized)) {
      errorMessage = 'المسمى موجود مسبقاً في كتالوج المسميات المعتمدة.';
    } else if (existingReviewsSet.has(normalized)) {
      errorMessage = 'هذا المسمى موجود بالفعل في سجلات المراجعة السابقة.';
    } else if (seenInCurrentBatch.has(normalized)) {
      errorMessage = 'مكرر ضمن نفس الدفعة المدخلة.';
    } else {
      seenInCurrentBatch.add(normalized);
    }

    // Automatically assign category per title (system auto-creates category if it does not exist)
    let itemCategoryId = null;
    if (categoryId) {
      itemCategoryId = resolvedCategoryId;
    } else {
      itemCategoryId = await resolveCategoryForTitle(title, categoryCache);
    }

    docsToInsert.push({
      batchId: batch._id,
      sequence: index + 1,
      source,
      originalTitle,
      finalTitle: title,
      categoryId: itemCategoryId || resolvedCategoryId,
      isCategoryManuallyEdited: Boolean(categoryId),
      status: errorMessage ? 'Failed' : 'Pending Review',
      errorMessage: errorMessage || ''
    });
  }

  await JobTitleReview.insertMany(docsToInsert, { ordered: false });
  const updatedBatch = await refreshBatch(batch._id);
  await logActivity({
    actorId: actor._id,
    actorRole: actor.role,
    action: 'JOB_TITLE_BATCH_CREATED',
    entityType: 'JobTitleBatch',
    entityId: batch._id,
    metadata: { batchNumber: batch.batchNumber, source, totalTitles: cleanedTitles.length },
    req
  });
  return getBatchById(updatedBatch._id);
}

async function createManualBatch({ text, categoryId, idempotencyKey, actor, req }) {
  return createBatch({ titles: parseLinesFromRawText(text || ''), source: 'manual', categoryId, idempotencyKey, actor, req });
}

async function createFileBatch({ file, categoryId, idempotencyKey, actor, req }) {
  if (!file?.buffer) {
    throw { statusCode: 400, code: 'FILE_REQUIRED', message: 'Please choose a file containing job titles.' };
  }
  const titles = await extractLinesFromFile(file.buffer, file.originalname, file.mimetype);
  if (!titles.length) {
    throw { statusCode: 422, code: 'NO_TITLES_EXTRACTED', message: 'لم يتم استخراج أي مسميات وظيفية من الملف. تأكد أن الملف يحتوي على نصوص قابلة للقراءة وليس صور أو ملف PDF مشفر.' };
  }
  return createBatch({
    titles,
    source: 'file',
    categoryId,
    originalFileName: file.originalname || '',
    idempotencyKey,
    actor,
    req
  });
}

async function listBatches(query = {}) {
  const { page, limit, skip } = getPagination(query, 20, 100);
  const filter = {};
  if (query.status) filter.status = query.status;
  const [items, total] = await Promise.all([
    JobTitleBatch.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('createdBy', 'email phone').populate('defaultCategoryId', 'name nameAr').lean(),
    JobTitleBatch.countDocuments(filter)
  ]);
  return { items, pagination: formatPagination(total, page, limit) };
}

async function getBatchById(batchId) {
  const batch = await JobTitleBatch.findById(batchId)
    .populate('createdBy', 'email phone').populate('defaultCategoryId', 'name nameAr').lean();
  if (!batch) throw { statusCode: 404, code: 'BATCH_NOT_FOUND', message: 'Job-title batch not found.' };
  return batch;
}

async function listReviews(query = {}) {
  const { page, limit, skip } = getPagination(query, 25, 100);
  const filter = {};
  if (query.archived === 'true') {
    filter.isArchived = true;
  } else {
    filter.isArchived = { $ne: true };
  }
  if (query.status) filter.status = query.status;
  if (query.batchId) filter.batchId = query.batchId;
  if (query.search?.trim()) {
    const escaped = query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ originalTitle: new RegExp(escaped, 'i') }, { finalTitle: new RegExp(escaped, 'i') }];
  }
  const [items, total] = await Promise.all([
    JobTitleReview.find(filter).sort({ createdAt: -1, sequence: 1 }).skip(skip).limit(limit)
      .populate('batchId', 'batchNumber source').populate('categoryId', 'name nameAr')
      .populate('reviewedBy', 'email phone').lean(),
    JobTitleReview.countDocuments(filter)
  ]);
  return { items, pagination: formatPagination(total, page, limit) };
}

async function getReviewById(id) {
  const review = await JobTitleReview.findById(id).populate('batchId', 'batchNumber source originalFileName')
    .populate('categoryId', 'name nameAr').populate('reviewedBy', 'email phone').lean();
  if (!review) throw { statusCode: 404, code: 'TITLE_REVIEW_NOT_FOUND', message: 'Job-title review record not found.' };
  return review;
}

async function editReview(id, { finalTitle, categoryId }, actor, req) {
  const review = await JobTitleReview.findById(id);
  if (!review) throw { statusCode: 404, code: 'TITLE_REVIEW_NOT_FOUND', message: 'Job-title review record not found.' };
  if (['Approved', 'Rejected'].includes(review.status)) {
    throw { statusCode: 409, code: 'REVIEW_FINALIZED', message: 'An approved or rejected title cannot be edited.' };
  }
  const cleanFinalTitle = cleanTitle(finalTitle);
  if (!cleanFinalTitle) throw { statusCode: 400, code: 'TITLE_REQUIRED', message: 'A final job title is required.' };
  if (categoryId) {
    await ensureCategory(categoryId);
    review.categoryId = categoryId;
    review.isCategoryManuallyEdited = true; // User manually chose category: never override
  }
  review.finalTitle = cleanFinalTitle;
  review.status = 'Edited';
  review.errorMessage = '';
  review.editedAt = new Date();
  review.reviewedBy = actor._id;
  review.reviewedAt = new Date();
  await review.save();
  await refreshBatch(review.batchId);
  await logActivity({ actorId: actor._id, actorRole: actor.role, action: 'JOB_TITLE_REVIEW_EDITED', entityType: 'JobTitleReview', entityId: review._id, req });
  return getReviewById(review._id);
}

async function approveReview(id, { finalTitle, categoryId }, actor, req) {
  let review = await JobTitleReview.findById(id);
  if (!review) throw { statusCode: 404, code: 'TITLE_REVIEW_NOT_FOUND', message: 'Job-title review record not found.' };
  if (review.status === 'Approved') return getReviewById(review._id); // idempotent repeat approval
  if (review.status === 'Rejected') throw { statusCode: 409, code: 'REVIEW_REJECTED', message: 'Rejected titles cannot be approved. Create a new review item instead.' };
  if (finalTitle !== undefined) review.finalTitle = cleanTitle(finalTitle);
  if (categoryId) {
    await ensureCategory(categoryId);
    review.categoryId = categoryId;
    review.isCategoryManuallyEdited = true;
  }
  const titleToApprove = cleanTitle(review.finalTitle || review.originalTitle);
  if (!titleToApprove) {
    review.status = 'Failed';
    review.errorMessage = 'المسمى الوظيفي مطلوب.';
    await review.save();
    await refreshBatch(review.batchId);
    return getReviewById(review._id);
  }

  // Ensure category is set
  if (!review.categoryId) {
    const categoryCache = await getCategoryCache();
    review.categoryId = await resolveCategoryForTitle(titleToApprove, categoryCache);
  }

  // Check catalog duplication: CATALOG NEVER ACCEPTS DUPLICATE JOB TITLES
  const normalized = normalizeForComparison(titleToApprove);
  const existingJobs = await Job.find({}).select('name nameAr').lean();
  const isDuplicate = existingJobs.some(
    (j) => normalizeForComparison(j.name) === normalized || normalizeForComparison(j.nameAr) === normalized
  );

  if (isDuplicate) {
    review.status = 'Failed';
    review.errorMessage = 'المسمى موجود مسبقاً في كتالوج المسميات المعتمدة.';
    review.isArchived = false;
    review.archivedAt = null;
    await review.save();
    await refreshBatch(review.batchId);
    return getReviewById(review._id);
  }

  review.status = 'Processing';
  review.errorMessage = '';
  await review.save();
  try {
    const job = await processSingleTitle({ name: titleToApprove, nameAr: titleToApprove, categoryId: review.categoryId });
    review.status = 'Approved';
    review.createdJobId = job._id;
    // Moving from review workspace to catalog: archive review record
    review.isArchived = true;
    review.archivedAt = new Date();
    review.errorMessage = '';
    review.reviewedBy = actor._id;
    review.reviewedAt = new Date();
    await review.save();
    await logActivity({ actorId: actor._id, actorRole: actor.role, action: 'JOB_TITLE_REVIEW_APPROVED', entityType: 'JobTitleReview', entityId: review._id, req });
  } catch (error) {
    review.status = 'Failed';
    review.errorMessage = error.message?.includes('المسمى موجود مسبقاً') || error.code === 11000
      ? 'المسمى موجود مسبقاً في كتالوج المسميات المعتمدة.'
      : (error.message || 'تعذر إضافة المسمى إلى الكتالوج.');
    review.isArchived = false;
    review.archivedAt = null;
    await review.save();
  }
  await refreshBatch(review.batchId);
  return getReviewById(review._id);
}

async function rejectReview(id, reason, actor, req) {
  if (!reason?.trim()) throw { statusCode: 400, code: 'REJECTION_REASON_REQUIRED', message: 'A rejection reason is required.' };
  const review = await JobTitleReview.findById(id);
  if (!review) throw { statusCode: 404, code: 'TITLE_REVIEW_NOT_FOUND', message: 'Job-title review record not found.' };
  if (review.status === 'Approved') throw { statusCode: 409, code: 'REVIEW_FINALIZED', message: 'Approved titles cannot be rejected.' };
  review.status = 'Rejected';
  review.rejectionReason = reason.trim();
  review.errorMessage = '';
  review.reviewedBy = actor._id;
  review.reviewedAt = new Date();
  review.isArchived = true;
  review.archivedAt = new Date();
  await review.save();
  await refreshBatch(review.batchId);
  await logActivity({ actorId: actor._id, actorRole: actor.role, action: 'JOB_TITLE_REVIEW_REJECTED', entityType: 'JobTitleReview', entityId: review._id, req });
  return getReviewById(review._id);
}

async function retryReview(id, actor, req) {
  const review = await JobTitleReview.findById(id);
  if (!review) throw { statusCode: 404, code: 'TITLE_REVIEW_NOT_FOUND', message: 'Job-title review record not found.' };
  if (review.status !== 'Failed') throw { statusCode: 409, code: 'NOT_RETRYABLE', message: 'Only failed job-title records can be retried.' };
  review.status = 'Processing';
  review.errorMessage = '';
  review.retryCount += 1;
  await review.save();
  try {
    const title = cleanTitle(review.finalTitle || review.originalTitle);
    if (!review.categoryId || !review.isCategoryManuallyEdited) {
      const categoryCache = await getCategoryCache();
      review.categoryId = await resolveCategoryForTitle(title, categoryCache);
    }
    const normalized = normalizeForComparison(title);
    const existingJobs = await Job.find({}).select('name nameAr').lean();
    const isDup = existingJobs.some((j) => normalizeForComparison(j.name) === normalized || normalizeForComparison(j.nameAr) === normalized);
    if (isDup) {
      review.status = 'Failed';
      review.errorMessage = 'المسمى موجود مسبقاً في كتالوج المسميات المعتمدة.';
    } else {
      review.status = 'Pending Review';
      review.errorMessage = '';
    }
    await review.save();
  } catch (error) {
    await JobTitleReview.findByIdAndUpdate(review._id, { status: 'Failed', errorMessage: error.message || 'Retry failed.' });
  }
  await refreshBatch(review.batchId);
  await logActivity({ actorId: actor._id, actorRole: actor.role, action: 'JOB_TITLE_REVIEW_RETRIED', entityType: 'JobTitleReview', entityId: review._id, req });
  return getReviewById(review._id);
}

async function bulkApproveReviews({ batchId, actor, req }) {
  const filter = {
    status: { $in: ['Pending Review', 'Edited'] },
    isArchived: { $ne: true }
  };
  if (batchId) filter.batchId = batchId;

  const reviews = await JobTitleReview.find(filter).sort({ sequence: 1 });
  if (!reviews.length) {
    return { approvedCount: 0, failedCount: 0, totalProcessed: 0, message: 'لا توجد مسميات قابلة للاعتماد.' };
  }

  // Load catalog jobs to strictly prevent duplicates
  const existingJobs = await Job.find({}).select('name nameAr').lean();
  const catalogSet = new Set(
    existingJobs.flatMap((j) => [normalizeForComparison(j.name), normalizeForComparison(j.nameAr)]).filter(Boolean)
  );

  const categoryCache = await getCategoryCache();
  let approvedCount = 0;
  let failedCount = 0;
  const batchIdsToRefresh = new Set();

  for (const review of reviews) {
    batchIdsToRefresh.add(String(review.batchId));
    const title = cleanTitle(review.finalTitle || review.originalTitle);
    const normalized = normalizeForComparison(title);

    if (!title) {
      review.status = 'Failed';
      review.errorMessage = 'المسمى الوظيفي مطلوب.';
      await review.save();
      failedCount++;
      continue;
    }

    if (!review.categoryId && !review.isCategoryManuallyEdited) {
      review.categoryId = await resolveCategoryForTitle(title, categoryCache);
    }

    // Check catalog duplication
    if (catalogSet.has(normalized)) {
      review.status = 'Failed';
      review.errorMessage = 'المسمى موجود مسبقاً في كتالوج المسميات المعتمدة.';
      review.isArchived = false;
      review.archivedAt = null;
      await review.save();
      failedCount++;
      continue;
    }

    try {
      const job = await Job.create({
        name: title,
        nameAr: title,
        categoryId: review.categoryId,
        isActive: true
      });
      catalogSet.add(normalized);

      review.status = 'Approved';
      review.createdJobId = job._id;
      review.errorMessage = '';
      review.isArchived = true;
      review.archivedAt = new Date();
      review.reviewedBy = actor._id;
      review.reviewedAt = new Date();
      await review.save();
      approvedCount++;
    } catch (err) {
      review.status = 'Failed';
      review.errorMessage = err.code === 11000
        ? 'المسمى موجود مسبقاً في كتالوج المسميات المعتمدة.'
        : (err.message || 'تعذر إضافة المسمى إلى الكتالوج.');
      review.isArchived = false;
      review.archivedAt = null;
      await review.save();
      failedCount++;
    }
  }

  for (const bId of batchIdsToRefresh) {
    await refreshBatch(bId);
  }

  await logActivity({
    actorId: actor._id,
    actorRole: actor.role,
    action: 'JOB_TITLE_REVIEWS_BULK_APPROVED',
    entityType: 'JobTitleBatch',
    metadata: { batchId, approvedCount, failedCount, total: reviews.length },
    req
  });

  return { approvedCount, failedCount, totalProcessed: reviews.length };
}

async function bulkRejectReviews({ reason, batchId, actor, req }) {
  if (!reason?.trim()) throw { statusCode: 400, code: 'REJECTION_REASON_REQUIRED', message: 'A rejection reason is required.' };
  const filter = {
    status: { $in: ['Pending Review', 'Edited', 'Failed'] },
    errorMessage: { $ne: '' }
  };
  if (batchId) filter.batchId = batchId;
  const reviews = await JobTitleReview.find(filter).select('_id batchId').lean();
  if (!reviews.length) throw { statusCode: 404, code: 'NOTHING_TO_REJECT', message: 'No records with issues found to reject.' };
  await JobTitleReview.updateMany(
    { _id: { $in: reviews.map((r) => r._id) } },
    { status: 'Rejected', rejectionReason: reason.trim(), errorMessage: '', reviewedBy: actor._id, reviewedAt: new Date(), isArchived: true, archivedAt: new Date() }
  );
  const batchIds = [...new Set(reviews.map((r) => String(r.batchId)))];
  await Promise.all(batchIds.map(refreshBatch));
  await logActivity({ actorId: actor._id, actorRole: actor.role, action: 'JOB_TITLE_BULK_REJECTED', entityType: 'JobTitleBatch', entityId: batchIds[0], metadata: { count: reviews.length }, req });
  return { rejectedCount: reviews.length };
}

async function deleteArchivedReview(id, actor, req) {
  const review = await JobTitleReview.findById(id);
  if (!review) throw { statusCode: 404, code: 'TITLE_REVIEW_NOT_FOUND', message: 'Job-title review record not found.' };
  if (!review.isArchived) throw { statusCode: 409, code: 'NOT_ARCHIVED', message: 'Only archived records can be permanently deleted.' };
  await JobTitleReview.deleteOne({ _id: id });
  await refreshBatch(review.batchId);
  await logActivity({ actorId: actor._id, actorRole: actor.role, action: 'JOB_TITLE_REVIEW_DELETED', entityType: 'JobTitleReview', entityId: review._id, req });
}

async function deleteAllArchivedReviews({ batchId, actor, req }) {
  const conditions = { $or: [{ isArchived: true }, { status: 'Rejected' }, { status: { $in: ['Pending Review', 'Failed', 'Processing'] } }] };
  const filter = batchId ? { $and: [{ batchId }, conditions] } : conditions;
  const reviews = await JobTitleReview.find(filter).select('_id batchId').lean();
  if (!reviews.length) throw { statusCode: 404, code: 'NOTHING_TO_DELETE', message: 'No archived records found to delete.' };
  await JobTitleReview.deleteMany({ _id: { $in: reviews.map((r) => r._id) } });
  const batchIds = [...new Set(reviews.map((r) => String(r.batchId)))];
  await Promise.all(batchIds.map(refreshBatch));
  await logActivity({ actorId: actor._id, actorRole: actor.role, action: 'JOB_TITLE_ARCHIVE_CLEARED', entityType: 'JobTitleBatch', entityId: batchIds[0], metadata: { count: reviews.length }, req });
  return { deletedCount: reviews.length };
}

module.exports = {
  createManualBatch, createFileBatch, listBatches, getBatchById,
  listReviews, getReviewById, editReview, approveReview, bulkApproveReviews,
  rejectReview, retryReview, runIndependently, bulkRejectReviews,
  deleteArchivedReview, deleteAllArchivedReviews
};
