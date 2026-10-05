const Candidate = require('../models/Candidate');
const { getPagination, formatPagination } = require('../utils/pagination');
const { logActivity } = require('./activity.service');

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
    availability,
    qualification
  } = queryParams;

  const targetJobId = jobId || desiredJobId;
  if (targetJobId && targetJobId.trim()) {
    filter.desiredJobId = targetJobId.trim();
  }

  if (candidateIds) {
    const ids = Array.isArray(candidateIds)
      ? candidateIds
      : String(candidateIds).split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      filter._id = { $in: ids };
    }
  }

  if (categoryId && categoryId.trim()) {
    filter.categoryId = categoryId.trim();
  }

  if (availability && availability.trim() && availability !== 'ALL') {
    filter.availabilityStatus = availability.trim();
  } else if (!availability) {
    // Default to 'Available' for employers looking for immediately ready candidates
    filter.availabilityStatus = 'Available';
  }

  if (governorate && governorate.trim() && governorate !== 'ALL') {
    filter.governorate = new RegExp(governorate.trim(), 'i');
  }

  if (area && area.trim() && area !== 'ALL') {
    filter.area = new RegExp(area.trim(), 'i');
  }

  if (qualification && qualification.trim() && qualification !== 'ALL') {
    filter.qualification = new RegExp(qualification.trim(), 'i');
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

  // Keyword search (Full name, skills, area)
  if (keyword && keyword.trim()) {
    const kw = keyword.trim();
    const regex = new RegExp(kw, 'i');
    filter.$or = [
      { fullName: regex },
      { skills: { $in: [regex] } },
      { area: regex },
      { qualification: regex }
    ];
  }

  return filter;
}

async function searchCandidates(queryParams, company, req) {
  const filter = buildCandidateFilters(queryParams);
  const { page, limit, skip } = getPagination(queryParams, 20);

  const [items, total] = await Promise.all([
    Candidate.find(filter)
      .select('fullName phone email desiredJobId categoryId governorate area yearsOfExperience qualification skills availabilityStatus cvUrl createdAt')
      .populate('desiredJobId', 'name nameAr')
      .populate('categoryId', 'name nameAr')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Candidate.countDocuments(filter)
  ]);

  // If performed by a company, increment searchesUsed and log activity
  if (company) {
    company.searchesUsed = (company.searchesUsed || 0) + 1;
    await company.save();

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
    fullName: c.fullName,
    phone: c.phone,
    email: c.email,
    desiredJob: c.desiredJobId,
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
