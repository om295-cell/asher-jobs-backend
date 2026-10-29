const mongoose = require('mongoose');
const Job = require('../models/Job');
const JobCategory = require('../models/JobCategory');
const Candidate = require('../models/Candidate');
const CandidateCart = require('../models/CandidateCart');
const { RecommendationRequest } = require('../models/RecommendationRequest');
const RecruitmentRequest = require('../models/RecruitmentRequest');
const JobTitleReview = require('../models/JobTitleReview');

// Helper to check if string contains Arabic characters
const hasArabic = (s) => /[\u0600-\u06FF]/.test(s || '');

// Specific overrides for known multi-category titles
const preferredCategoryForTitle = {
  'internal auditor': 'Accounting & Finance',
  'warehouse supervisor': 'Warehousing & Logistics',
  'stock controller': 'Warehousing & Logistics',
  'inventory controller': 'Warehousing & Logistics',
  'store manager': 'Warehousing & Logistics',
  'assistant manager': 'HR & Administration',
  'surveying manager': 'Engineering',
  'draftsman': 'Engineering',
  'it director': 'Engineering',
  'quality engineer': 'Quality & Inspection',
  'qhse manager': 'Quality & Inspection',
  'microbiologist': 'Quality & Inspection',
  'mechanical maintenance supervisor': 'Maintenance & Technical',
  'sales supervisor': 'Sales & Marketing',
  'customer service supervisor': 'Sales & Marketing',
  'digital marketer': 'Sales & Marketing',
  'social media specialist': 'Sales & Marketing',
  'seo specialist': 'Sales & Marketing',
  'graphic designer': 'Sales & Marketing',
  'workers supervisor': 'Production & Manufacturing',
  'aisle coordinator': 'Sales & Marketing',
  'site accountant': 'Accounting & Finance',
  'customer accounts accountant': 'Accounting & Finance',
  'general accountant': 'Accounting & Finance',
  'interior designer': 'Engineering',
  'document controller': 'Quality & Inspection',
  'content writer': 'Sales & Marketing',
  'medical representative': 'Sales & Marketing',
  'security guard': 'Production & Manufacturing',
  'timekeeper': 'HR & Administration',
  'receptionist': 'HR & Administration',
  'executive engineer': 'Engineering',
  'chemist': 'Quality & Inspection',
  'branch manager': 'Sales & Marketing',
  'personnel manager': 'HR & Administration',
  'project manager': 'HR & Administration'
};

const categoryPreference = {
  'Accounting & Finance': 10,
  'Warehousing & Logistics': 10,
  'HR & Administration': 10,
  'Engineering': 10,
  'Quality & Inspection': 10,
  'Maintenance & Technical': 10,
  'Production & Manufacturing': 10,
  'Sales & Marketing': 10,
  'Drivers & Logistics': 10,
  'Specialized & Other': 1
};

function normalizeText(s) {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/[\u064B-\u065F\u0670\s\(\)\-_]/g, '');
}

/**
 * Merge duplicate job titles across any categories in the database.
 * If 2 or more titles have the same name (English or Arabic), merges them into
 * a single canonical job, updates all candidate and system references, and removes duplicates.
 */
async function mergeDuplicateJobTitles(options = {}) {
  const { dryRun = false, logger = console } = options;

  logger.log('[TitleDeduplication] Starting duplicate job titles audit and merge...');

  // 1. Fetch all categories into a lookup map
  const categories = await JobCategory.find({}).lean();
  const categoryMap = new Map();
  categories.forEach((cat) => {
    categoryMap.set(String(cat._id), cat);
  });

  // 2. Fetch all jobs
  const allJobs = await Job.find({}).lean();
  logger.log(`[TitleDeduplication] Total jobs in database before deduplication: ${allJobs.length}`);

  if (allJobs.length === 0) {
    return {
      totalBefore: 0,
      totalAfter: 0,
      duplicateGroupsCount: 0,
      mergedJobsCount: 0,
      candidatesUpdatedCount: 0
    };
  }

  // 3. Group jobs by name similarity (English name, Arabic name, or swapped)
  const groups = [];
  for (const job of allJobs) {
    const enName = (job.name || '').trim().toLowerCase();
    const arName = (job.nameAr || '').trim();
    const normEn = normalizeText(job.name);
    const normAr = normalizeText(job.nameAr);

    let matchedGroup = null;
    for (const g of groups) {
      const match = g.items.some((item) => {
        const itemEn = (item.name || '').trim().toLowerCase();
        const itemAr = (item.nameAr || '').trim();
        const itemNormEn = normalizeText(item.name);
        const itemNormAr = normalizeText(item.nameAr);

        return (
          (enName && itemEn && enName === itemEn) ||
          (normEn && itemNormEn && normEn === itemNormEn) ||
          (arName && itemAr && arName === itemAr) ||
          (normAr && itemNormAr && normAr === itemNormAr) ||
          (arName && itemEn && arName === itemEn) ||
          (enName && itemAr && enName === itemAr) ||
          (normAr && itemNormEn && normAr === itemNormEn) ||
          (normEn && itemNormAr && normEn === itemNormAr)
        );
      });

      if (match) {
        matchedGroup = g;
        break;
      }
    }

    if (matchedGroup) {
      matchedGroup.items.push(job);
    } else {
      groups.push({ items: [job] });
    }
  }

  const duplicateGroups = groups.filter((g) => g.items.length > 1);
  logger.log(`[TitleDeduplication] Found ${duplicateGroups.length} groups of duplicate titles across categories.`);

  let totalMergedJobs = 0;
  let totalCandidatesUpdated = 0;

  for (const group of duplicateGroups) {
    const items = group.items;

    // Count candidate references for each job to prioritize preserving existing IDs
    const jobRefCounts = new Map();
    for (const item of items) {
      const count = await Candidate.countDocuments({
        $or: [
          { desiredJobId: item._id },
          { secondJobId: item._id },
          { thirdJobId: item._id },
          { 'desiredJobs.jobId': item._id }
        ]
      });
      jobRefCounts.set(String(item._id), count);
    }

    // Pick best canonical job
    let canonical = items[0];
    for (let i = 1; i < items.length; i++) {
      const candidate = items[i];
      const refsCanonical = jobRefCounts.get(String(canonical._id)) || 0;
      const refsCandidate = jobRefCounts.get(String(candidate._id)) || 0;

      const normCan = (canonical.name || '').trim().toLowerCase();
      const normCand = (candidate.name || '').trim().toLowerCase();

      // Check title-specific preferred category override
      const prefCat = preferredCategoryForTitle[normCan] || preferredCategoryForTitle[normCand];
      const canCatName = categoryMap.get(String(canonical.categoryId))?.name || '';
      const candCatName = categoryMap.get(String(candidate.categoryId))?.name || '';

      if (prefCat) {
        if (candCatName === prefCat && canCatName !== prefCat) {
          canonical = candidate;
          continue;
        }
        if (canCatName === prefCat && candCatName !== prefCat) {
          continue;
        }
      }

      // If one has significantly more candidate references, prioritize it
      if (refsCandidate > refsCanonical) {
        canonical = candidate;
        continue;
      } else if (refsCanonical > refsCandidate) {
        continue;
      }

      // English name should NOT contain Arabic if the other has pure English
      const canHasAr = hasArabic(canonical.name);
      const candHasAr = hasArabic(candidate.name);
      if (canHasAr && !candHasAr) {
        canonical = candidate;
        continue;
      } else if (!canHasAr && candHasAr) {
        continue;
      }

      // Specific category beats Specialized & Other
      const scoreCan = categoryPreference[canCatName] || 5;
      const scoreCand = categoryPreference[candCatName] || 5;
      if (scoreCand > scoreCan) {
        canonical = candidate;
        continue;
      }
    }

    // Find cleanest English name (preferably without Arabic letters)
    const nonArItem = items.find((j) => !hasArabic(j.name));
    const targetName = nonArItem ? nonArItem.name.trim() : canonical.name.trim();

    // Find cleanest Arabic name
    const arItem = items.find((j) => hasArabic(j.nameAr));
    const targetNameAr = arItem ? arItem.nameAr.trim() : canonical.nameAr.trim();

    // Find best category
    let targetCategoryId = canonical.categoryId;
    const canCat = categoryMap.get(String(canonical.categoryId));
    if (canCat && canCat.name === 'Specialized & Other') {
      const betterItem = items.find((j) => {
        const c = categoryMap.get(String(j.categoryId));
        return c && c.name !== 'Specialized & Other';
      });
      if (betterItem) {
        targetCategoryId = betterItem.categoryId;
      }
    }

    const duplicatesToRemove = items.filter((j) => String(j._id) !== String(canonical._id));

    logger.log(
      `[TitleDeduplication] Merging ${duplicatesToRemove.length} duplicate(s) for "${targetName}" / "${targetNameAr}" into canonical ID: ${canonical._id}`
    );

    if (dryRun) {
      totalMergedJobs += duplicatesToRemove.length;
      continue;
    }

    // Update canonical job with best clean names and category
    await Job.updateOne(
      { _id: canonical._id },
      {
        $set: {
          name: targetName,
          nameAr: targetNameAr,
          categoryId: targetCategoryId,
          isActive: true
        }
      }
    );

    // Update all references in candidates and other collections
    for (const dup of duplicatesToRemove) {
      const dupId = dup._id;

      // 1. Update Candidate desiredJobId
      const desiredRes = await Candidate.updateMany(
        { desiredJobId: dupId },
        {
          $set: {
            desiredJobId: canonical._id,
            jobTitle: targetNameAr
          }
        }
      );

      // 2. Update Candidate secondJobId
      await Candidate.updateMany(
        { secondJobId: dupId },
        { $set: { secondJobId: canonical._id } }
      );

      // 3. Update Candidate thirdJobId
      await Candidate.updateMany(
        { thirdJobId: dupId },
        { $set: { thirdJobId: canonical._id } }
      );

      // Clean up candidates where secondJobId or thirdJobId duplicates desiredJobId
      await Candidate.updateMany(
        { desiredJobId: canonical._id, secondJobId: canonical._id },
        { $set: { secondJobId: null, secondCareerLevel: '' } }
      );
      await Candidate.updateMany(
        { thirdJobId: canonical._id, $or: [{ desiredJobId: canonical._id }, { secondJobId: canonical._id }] },
        { $set: { thirdJobId: null, thirdCareerLevel: '' } }
      );

      // 4. Update Candidate desiredJobs array
      const candidatesWithDesiredJob = await Candidate.find({ 'desiredJobs.jobId': dupId });
      for (const cand of candidatesWithDesiredJob) {
        let modified = false;
        const newDesiredJobs = [];
        const seenJobIds = new Set();

        for (const dj of cand.desiredJobs || []) {
          const isTargetDup = String(dj.jobId) === String(dupId);
          const currentJobIdStr = isTargetDup ? String(canonical._id) : String(dj.jobId);

          if (!seenJobIds.has(currentJobIdStr)) {
            seenJobIds.add(currentJobIdStr);
            if (isTargetDup) {
              modified = true;
              newDesiredJobs.push({
                jobId: canonical._id,
                jobTitle: targetName,
                jobTitleAr: targetNameAr,
                careerLevel: dj.careerLevel || '',
                priority: dj.priority || 1
              });
            } else {
              newDesiredJobs.push(dj);
            }
          } else {
            // Already present, skip duplicate entry
            modified = true;
          }
        }

        if (modified) {
          cand.desiredJobs = newDesiredJobs;
          await cand.save();
        }
      }

      // 5. Update CandidateCart
      await CandidateCart.updateMany(
        { 'items.jobId': dupId },
        { $set: { 'items.$[elem].jobId': canonical._id } },
        { arrayFilters: [{ 'elem.jobId': dupId }] }
      );

      // 6. Update RecommendationRequest
      await RecommendationRequest.updateMany(
        { jobId: dupId },
        { $set: { jobId: canonical._id, jobTitle: targetName, jobTitleAr: targetNameAr } }
      );
      await RecommendationRequest.updateMany(
        { 'people.jobId': dupId },
        { $set: { 'people.$[elem].jobId': canonical._id, 'people.$[elem].jobTitle': targetName, 'people.$[elem].jobTitleAr': targetNameAr } },
        { arrayFilters: [{ 'elem.jobId': dupId }] }
      );
      await RecommendationRequest.updateMany(
        { 'people.titles.jobId': dupId },
        { $set: { 'people.$[].titles.$[titleElem].jobId': canonical._id, 'people.$[].titles.$[titleElem].jobTitle': targetName, 'people.$[].titles.$[titleElem].jobTitleAr': targetNameAr } },
        { arrayFilters: [{ 'titleElem.jobId': dupId }] }
      );

      // 7. Update RecruitmentRequest
      await RecruitmentRequest.updateMany(
        { jobId: dupId },
        { $set: { jobId: canonical._id, categoryId: targetCategoryId } }
      );

      // 8. Update JobTitleReview
      await JobTitleReview.updateMany(
        { createdJobId: dupId },
        { $set: { createdJobId: canonical._id } }
      );

      // 9. Delete the duplicate Job document
      await Job.deleteOne({ _id: dupId });

      totalMergedJobs++;
      totalCandidatesUpdated += (desiredRes.modifiedCount || 0);
    }
  }

  // 4. Drop legacy compound index and ensure cross-category unique index
  try {
    const indexes = await Job.collection.indexes();
    const legacyIndex = indexes.find((idx) => idx.key && idx.key.name === 1 && idx.key.categoryId === 1);
    if (legacyIndex) {
      logger.log(`[TitleDeduplication] Dropping legacy compound index "${legacyIndex.name}"...`);
      await Job.collection.dropIndex(legacyIndex.name);
    }
  } catch (idxErr) {
    logger.warn(`[TitleDeduplication] Index cleanup warning: ${idxErr.message}`);
  }

  // Ensure new unique index on name
  try {
    await Job.collection.createIndex({ name: 1 }, { unique: true });
    logger.log('[TitleDeduplication] Created unique index on job "name".');
  } catch (idxErr) {
    logger.warn(`[TitleDeduplication] createIndex error: ${idxErr.message}`);
  }

  const finalJobCount = await Job.countDocuments();
  logger.log(`[TitleDeduplication] Completed! Total jobs after merge: ${finalJobCount}. Merged duplicates: ${totalMergedJobs}.`);

  return {
    totalBefore: allJobs.length,
    totalAfter: finalJobCount,
    duplicateGroupsCount: duplicateGroups.length,
    mergedJobsCount: totalMergedJobs,
    candidatesUpdatedCount: totalCandidatesUpdated
  };
}

module.exports = {
  mergeDuplicateJobTitles,
  preferredCategoryForTitle
};
