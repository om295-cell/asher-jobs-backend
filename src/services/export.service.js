const XLSX = require('xlsx');
const { stringify } = require('csv-stringify/sync');
const Candidate = require('../models/Candidate');
const { buildCandidateFilters } = require('./search.service');
const { logActivity } = require('./activity.service');

async function getExportRecords(queryParams, company = null) {
  const filter = buildCandidateFilters(queryParams);

  // Maximum allowed per file: 10 candidates for companies, 1000 for admins
  const maxLimit = company ? 10 : 1000;
  const requestedLimit = parseInt(queryParams.limit, 10);
  const limit = (requestedLimit && requestedLimit > 0)
    ? Math.min(requestedLimit, maxLimit)
    : maxLimit;

  const candidates = await Candidate.find(filter)
    .select('fullName phone desiredJobId categoryId governorate area yearsOfExperience qualification skills availabilityStatus createdAt')
    .populate('desiredJobId', 'name nameAr')
    .populate('categoryId', 'name nameAr')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return candidates.map((c) => ({
    'Candidate Name': c.fullName,
    'Phone': c.phone,
    'Desired Job': c.desiredJobId ? c.desiredJobId.name : 'N/A',
    'Desired Job (Arabic)': c.desiredJobId ? c.desiredJobId.nameAr : 'N/A',
    'Category': c.categoryId ? c.categoryId.name : 'N/A',
    'Governorate': c.governorate,
    'Area': c.area,
    'Years of Experience': c.yearsOfExperience,
    'Qualification': c.qualification,
    'Skills': Array.isArray(c.skills) ? c.skills.join(', ') : '',
    'Availability': c.availabilityStatus,
    'Registration Date': c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-GB') : ''
  }));
}

async function exportCandidatesCSV(queryParams, company, req) {
  const rows = await getExportRecords(queryParams, company);

  if (company) {
    company.exportsUsed = (company.exportsUsed || 0) + 1;
    await company.save();

    await logActivity({
      actorId: company.userId,
      actorRole: 'company',
      action: 'EXPORT_CREATED',
      entityType: 'Candidate',
      metadata: { format: 'csv', count: rows.length, queryParams },
      req
    });
  }

  // Prepend UTF-8 BOM so Excel opens Arabic candidate data cleanly
  const csvString = '\ufeff' + stringify(rows, { header: true });
  return csvString;
}

async function exportCandidatesXLSX(queryParams, company, req) {
  const rows = await getExportRecords(queryParams, company);

  if (company) {
    company.exportsUsed = (company.exportsUsed || 0) + 1;
    await company.save();

    await logActivity({
      actorId: company.userId,
      actorRole: 'company',
      action: 'EXPORT_CREATED',
      entityType: 'Candidate',
      metadata: { format: 'xlsx', count: rows.length, queryParams },
      req
    });
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Candidates');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return buffer;
}

module.exports = {
  exportCandidatesCSV,
  exportCandidatesXLSX
};
