const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const { getPagination, formatPagination } = require('../utils/pagination');
const { logActivity } = require('./activity.service');
const { escapeRegex } = require('../middleware/sanitize.middleware');

function buildCandidateFilters(queryParams) {
  const filter = {
    accountStatus: 'active',
    isDeleted: false
  };

  const {
    jobId,
    desiredJobId,
    candidateIds,
    categoryId,
    keyword,
    governorate,
    area,
    minExperience,
    maxExperience,
    qualification
  } = queryParams;

  let jobFilterOr = null;
  const targetJobId = jobId || desiredJobId;
  if (targetJobId && targetJobId.trim()) {
    const tid = targetJobId.trim();
    if (mongoose.Types.ObjectId.isValid(tid)) {
      const objId = new mongoose.Types.ObjectId(tid);
      jobFilterOr = [
        { desiredJobId: objId },
        { secondJobId: objId },
        { thirdJobId: objId }
      ];
    } else {
      filter.desiredJobId = tid;
    }
  }

  if (candidateIds) {
    const ids = Array.isArray(candidateIds)
      ? candidateIds
      : String(candidateIds).split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      filter._id = { $in: ids };
    }
  }

  if (categoryId && categoryId.trim() && categoryId.trim() !== 'ALL') {
    const cid = categoryId.trim();
    if (mongoose.Types.ObjectId.isValid(cid)) {
      filter.categoryId = new mongoose.Types.ObjectId(cid);
    } else {
      filter.categoryId = cid;
    }
  }

  // Employer discovery is restricted to candidates who currently opt in as
  // Available. Never let a query parameter expose hired or unavailable profiles.
  filter.availabilityStatus = 'Available';

  if (governorate && governorate.trim() && governorate !== 'ALL') {
    filter.governorate = new RegExp(escapeRegex(governorate.trim()), 'i');
  }

  if (area && area.trim() && area !== 'ALL') {
    filter.area = new RegExp(escapeRegex(area.trim()), 'i');
  }

  if (qualification && qualification.trim() && qualification !== 'ALL') {
    filter.qualification = new RegExp(escapeRegex(qualification.trim()), 'i');
  }

  // Experience range
  if (minExperience !== undefined && minExperience !== '' || maxExperience !== undefined && maxExperience !== '') {
    filter.yearsOfExperience = {};
    if (minExperience !== undefined && minExperience !== '') {
      filter.yearsOfExperience.$gte = Number(minExperience);
    }
    if (maxExperience !== undefined && maxExperience !== '') {
      filter.yearsOfExperience.$lte = Number(maxExperience);
    }
  }

  // Keyword search (Full name, skills, area) combined with job matching
  if (keyword && keyword.trim()) {
    const kw = keyword.trim();
    const regex = new RegExp(escapeRegex(kw), 'i');
    const keywordOr = [
      { fullName: regex },
      { skills: { $in: [regex] } },
      { area: regex },
      { qualification: regex }
    ];

    if (jobFilterOr) {
      filter.$and = [
        { $or: jobFilterOr },
        { $or: keywordOr }
      ];
    } else {
      filter.$or = keywordOr;
    }
  } else if (jobFilterOr) {
    filter.$or = jobFilterOr;
  }

  return filter;
}

async function searchCandidates(queryParams, company, req) {
  const filter = buildCandidateFilters(queryParams);
  const { page, limit, skip } = getPagination(queryParams, 20);

  const targetJobId = queryParams.jobId || queryParams.desiredJobId;
  const isTargetJobValid = targetJobId && targetJobId.trim() && mongoose.Types.ObjectId.isValid(targetJobId.trim());
  const targetJobObjId = isTargetJobValid ? new mongoose.Types.ObjectId(targetJobId.trim()) : null;

  let items;
  let total;

  if (targetJobObjId) {
    // Priority of appearing when companies search: 1st job added → priority 1, 2nd job → priority 2, 3rd job → priority 3
    const [rawItems, count] = await Promise.all([
      Candidate.aggregate([
        { $match: filter },
        {
          $addFields: {
            matchPriority: {
              $cond: [
                { $eq: ['$desiredJobId', targetJobObjId] },
                1,
                {
                  $cond: [
                    { $eq: ['$secondJobId', targetJobObjId] },
                    2,
                    {
                      $cond: [
                        { $eq: ['$thirdJobId', targetJobObjId] },
                        3,
                        4
                      ]
                    }
                  ]
                }
              ]
            }
          }
        },
        { $sort: { matchPriority: 1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limit }
      ]),
      Candidate.countDocuments(filter)
    ]);

    total = count;
    items = await Candidate.populate(rawItems, [
      { path: 'desiredJobId', select: 'name nameAr' },
      { path: 'secondJobId', select: 'name nameAr' },
      { path: 'thirdJobId', select: 'name nameAr' },
      { path: 'categoryId', select: 'name nameAr' },
      { path: 'desiredJobs.jobId', select: 'name nameAr' }
    ]);
  } else {
    const [rawItems, count] = await Promise.all([
      Candidate.find(filter)
        .select('fullName phone email desiredJobId secondJobId thirdJobId careerLevel secondCareerLevel thirdCareerLevel desiredJobs categoryId governorate area yearsOfExperience qualification skills availabilityStatus cvUrl createdAt')
        .populate('desiredJobId', 'name nameAr')
        .populate('secondJobId', 'name nameAr')
        .populate('thirdJobId', 'name nameAr')
        .populate('categoryId', 'name nameAr')
        .populate('desiredJobs.jobId', 'name nameAr')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Candidate.countDocuments(filter)
    ]);
    items = rawItems;
    total = count;
  }

  // Quota middleware owns company search accounting. Keep the activity log here,
  // but do not increment the monthly counter a second time.
  if (company) {
    await logActivity({
      actorId: company.userId,
      actorRole: 'company',
      action: 'CANDIDATE_SEARCH',
      entityType: 'Candidate',
      metadata: { queryParams, resultsCount: total },
      req
    });
  }

  // Transform candidates to company DTO
  const sanitizedItems = items.map((c) => ({
    id: c._id,
    _id: c._id,
    fullName: c.fullName,
    phone: c.phone,
    email: c.email,
    desiredJob: c.desiredJobId,
    desiredJobId: c.desiredJobId,
    secondJob: c.secondJobId,
    secondJobId: c.secondJobId,
    thirdJob: c.thirdJobId,
    thirdJobId: c.thirdJobId,
    careerLevel: c.careerLevel || '',
    secondCareerLevel: c.secondCareerLevel || '',
    thirdCareerLevel: c.thirdCareerLevel || '',
    desiredJobs: c.desiredJobs || [],
    matchPriority: c.matchPriority || (targetJobObjId ? (
      String(c.desiredJobId?._id || c.desiredJobId) === String(targetJobObjId) ? 1 :
      String(c.secondJobId?._id || c.secondJobId) === String(targetJobObjId) ? 2 :
      String(c.thirdJobId?._id || c.thirdJobId) === String(targetJobObjId) ? 3 : 1
    ) : null),
    category: c.categoryId,
    governorate: c.governorate,
    area: c.area,
    yearsOfExperience: c.yearsOfExperience,
    qualification: c.qualification,
    skills: c.skills,
    availabilityStatus: c.availabilityStatus,
    hasCv: !!c.cvUrl,
    createdAt: c.createdAt
  }));

  return {
    items: sanitizedItems,
    pagination: formatPagination(total, page, limit)
  };
}

module.exports = {
  buildCandidateFilters,
  searchCandidates
};
