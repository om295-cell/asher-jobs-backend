const mongoose = require('mongoose');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const CandidateCart = require('../models/CandidateCart');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const { getPlanLimits, checkAndConsumeDownloadQuota } = require('./entitlement.service');
const { logActivity } = require('./activity.service');

const MAX_CART_TITLES = 10;
const MAX_CART_EXPORT_CANDIDATES = 100;

/**
 * Builds candidate matching criteria for a job title and optional career level
 */
function buildCandidateMatchQuery(jobId, careerLevel = '') {
  const jId = mongoose.Types.ObjectId.isValid(jobId) ? new mongoose.Types.ObjectId(jobId) : jobId;
  const cleanLevel = (careerLevel || '').trim();

  const baseQuery = {
    availabilityStatus: 'Available',
    accountStatus: 'active',
    isDeleted: false
  };

  if (cleanLevel && cleanLevel !== 'all' && cleanLevel !== 'الكل') {
    baseQuery.$or = [
      { desiredJobId: jId, careerLevel: cleanLevel },
      { secondJobId: jId, secondCareerLevel: cleanLevel },
      { thirdJobId: jId, thirdCareerLevel: cleanLevel },
      { desiredJobs: { $elemMatch: { jobId: jId, careerLevel: cleanLevel } } }
    ];
  } else {
    baseQuery.$or = [
      { desiredJobId: jId },
      { secondJobId: jId },
      { thirdJobId: jId },
      { 'desiredJobs.jobId': jId }
    ];
  }

  return baseQuery;
}

/**
 * Retrieve current cart for an employer account with populated job details,
 * matching candidates preview, and available candidate counts.
 */
async function getCart(companyId) {
  let cart = await CandidateCart.findOne({ companyId }).populate('items.jobId', 'name nameAr categoryId').lean();
  if (!cart) {
    cart = { companyId, items: [] };
  }

  // Enrich with matching available candidate counts and candidate list preview
  const enrichedItems = await Promise.all(
    (cart.items || []).map(async (item) => {
      if (!item.jobId) return item;
      const jId = item.jobId._id || item.jobId;
      const requestedQty = Math.max(1, Math.min(10, parseInt(item.quantity, 10) || 1));
      const careerLevel = (item.careerLevel || '').trim();

      const matchQuery = buildCandidateMatchQuery(jId, careerLevel);
      const availableCount = await Candidate.countDocuments(matchQuery);

      const candidates = await Candidate.find(matchQuery)
        .select('fullName phone governorate area yearsOfExperience qualification careerLevel secondCareerLevel thirdCareerLevel desiredJobId secondJobId thirdJobId')
        .populate('desiredJobId', 'name nameAr')
        .populate('secondJobId', 'name nameAr')
        .populate('thirdJobId', 'name nameAr')
        .sort({ createdAt: -1 })
        .limit(requestedQty)
        .lean();

      return {
        ...item,
        quantity: requestedQty,
        careerLevel,
        candidates,
        availableCandidatesCount: availableCount,
        isSufficient: availableCount >= requestedQty
      };
    })
  );

  return {
    ...cart,
    items: enrichedItems
  };
}

/**
 * Add or update items in the multi-title cart.
 * Supports:
 * 1) Bulk multi-search: { items: [{ jobId, quantity, careerLevel }], replace: true|false }
 * 2) Single item upsert: { jobId, quantity, careerLevel, notes }
 */
async function addOrUpdateCartItem(company, payload) {
  const planLimits = await getPlanLimits(company.subscriptionPlan);
  if (!planLimits.cartEnabled) {
    throw {
      statusCode: 403,
      message: 'خاصية سلة المرشحين المتعددة متاحة فقط لمشتركي الباقة الذهبية (Gold) والبلاتينية (Platinum).',
      code: 'CART_NOT_PERMITTED'
    };
  }

  let cart = await CandidateCart.findOne({ companyId: company._id });
  if (!cart) {
    cart = new CandidateCart({ companyId: company._id, items: [] });
  }

  // Case A: Bulk Multi-Search Add/Replace
  if (Array.isArray(payload.items)) {
    const rawItems = payload.items;
    if (rawItems.length === 0) {
      if (payload.replace) {
        cart.items = [];
        await cart.save();
      }
      return getCart(company._id);
    }

    if (rawItems.length > MAX_CART_TITLES) {
      throw {
        statusCode: 400,
        message: `يمكن إضافة بحد أقصى ${MAX_CART_TITLES} مسميات وظيفية في السلة.`,
        code: 'CART_TITLE_LIMIT_EXCEEDED'
      };
    }

    const validatedItems = [];
    for (const raw of rawItems) {
      if (!raw.jobId || !mongoose.Types.ObjectId.isValid(raw.jobId)) continue;
      const cleanQty = Math.max(1, Math.min(planLimits.maxCandidatesPerTitle || 10, parseInt(raw.quantity, 10) || 1));
      validatedItems.push({
        jobId: raw.jobId,
        quantity: cleanQty,
        careerLevel: (raw.careerLevel || '').trim(),
        notes: (raw.notes || '').trim()
      });
    }

    if (payload.replace) {
      cart.items = validatedItems.slice(0, MAX_CART_TITLES);
    } else {
      // Merge with existing items
      for (const vItem of validatedItems) {
        const existIdx = cart.items.findIndex((item) => String(item.jobId) === String(vItem.jobId));
        if (existIdx > -1) {
          cart.items[existIdx].quantity = vItem.quantity;
          cart.items[existIdx].careerLevel = vItem.careerLevel;
          if (vItem.notes) cart.items[existIdx].notes = vItem.notes;
        } else if (cart.items.length < MAX_CART_TITLES) {
          cart.items.push(vItem);
        }
      }
    }

    await cart.save();
    return getCart(company._id);
  }

  // Case B: Single Item Upsert
  const { jobId, quantity = 1, careerLevel = '', notes = '' } = payload;
  if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {
    throw { statusCode: 400, message: 'يرجى اختيار مسمى وظيفي صالح.', code: 'INVALID_JOB_ID' };
  }

  const job = await Job.findById(jobId);
  if (!job || job.isActive === false) {
    throw { statusCode: 404, message: 'المسمى الوظيفي غير موجود أو غير نشط.', code: 'JOB_NOT_FOUND' };
  }

  const cleanQuantity = Math.max(1, Math.min(planLimits.maxCandidatesPerTitle || 10, parseInt(quantity, 10) || 1));
  const cleanLevel = (careerLevel || '').trim();

  const existingIndex = cart.items.findIndex((item) => String(item.jobId) === String(jobId));
  if (existingIndex > -1) {
    cart.items[existingIndex].quantity = cleanQuantity;
    cart.items[existingIndex].careerLevel = cleanLevel;
    if (notes !== undefined) cart.items[existingIndex].notes = notes;
  } else {
    if (cart.items.length >= MAX_CART_TITLES) {
      throw {
        statusCode: 400,
        message: `سلة المرشحين تتسع لـ ${MAX_CART_TITLES} مسميات وظيفية كحد أقصى.`,
        code: 'CART_TITLE_LIMIT_EXCEEDED'
      };
    }
    cart.items.push({
      jobId,
      quantity: cleanQuantity,
      careerLevel: cleanLevel,
      notes: notes || ''
    });
  }

  await cart.save();
  return getCart(company._id);
}

/**
 * Remove an item from the cart
 */
async function removeCartItem(companyId, itemId) {
  const cart = await CandidateCart.findOne({ companyId });
  if (!cart) return { companyId, items: [] };

  cart.items = cart.items.filter((item) => String(item._id) !== String(itemId) && String(item.jobId) !== String(itemId));
  await cart.save();

  return getCart(companyId);
}

/**
 * Clear all items in the cart
 */
async function clearCart(companyId) {
  await CandidateCart.findOneAndUpdate({ companyId }, { $set: { items: [] } }, { upsert: true });
  return { companyId, items: [] };
}

/**
 * OWASP A03 / CWE-1236: Prevent CSV/Formula Injection in cart exports
 */
function sanitizeExcelCell(val) {
  if (val === null || val === undefined) return '';
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${val}`;
  }
  return val;
}

/**
 * Format candidate fields for export
 */
function formatCandidateRow(c, jobTitleName, careerLevelFilter = '') {
  return {
    'المسمى المطلوب': sanitizeExcelCell(jobTitleName || 'N/A'),
    'مستوى الخبرة المحدد': sanitizeExcelCell(careerLevelFilter || 'الكل'),
    'اسم المرشح': sanitizeExcelCell(c.fullName || 'N/A'),
    'رقم الهاتف': sanitizeExcelCell(c.phone || 'N/A'),
    'مستوى خبرة المرشح': sanitizeExcelCell(c.careerLevel || 'N/A'),
    'المحافظة': sanitizeExcelCell(c.governorate || 'الشرقية'),
    'المنطقة': sanitizeExcelCell(c.area || 'العاشر من رمضان'),
    'سنوات الخبرة': c.yearsOfExperience !== undefined ? c.yearsOfExperience : '',
    'المؤهل الدراسي': sanitizeExcelCell(c.qualification || ''),
    'المسمى الأساسي المسجل': sanitizeExcelCell(c.desiredJobId ? (c.desiredJobId.nameAr || c.desiredJobId.name) : 'N/A'),
    'المسمى الثاني': sanitizeExcelCell(c.secondJobId ? (c.secondJobId.nameAr || c.secondJobId.name) : 'لا يوجد'),
    'المسمى الثالث': sanitizeExcelCell(c.thirdJobId ? (c.thirdJobId.nameAr || c.thirdJobId.name) : 'لا يوجد')
  };
}

/**
 * Clean string for safe Excel sheet name (max 31 chars, no invalid chars : \ / ? * [ ])
 */
function getSafeSheetName(name, fallback = 'Candidates') {
  if (!name || typeof name !== 'string') return fallback;
  const clean = name.replace(/[\\/?*[\]:]/g, '').trim().slice(0, 30);
  return clean || fallback;
}

/**
 * Export cart candidates:
 * Format 1: 'multi_sheet' -> Single Excel file with multiple sheets/pages (each sheet = 1 job title)
 * Format 2: 'zip' -> A ZIP file containing separate Excel files (each file = 1 job title)
 * Format 3: 'single_sheet' / 'single_sheet_categorized' -> Single Excel sheet with all candidates
 */
async function exportCartExcel(company, options = {}, req = null) {
  const format = options.format || options.exportFormat || 'multi_sheet';
  const planLimits = await getPlanLimits(company.subscriptionPlan);

  if (!planLimits.cartEnabled) {
    throw {
      statusCode: 403,
      message: 'خاصية تصدير سلة المرشحين متاحة فقط لمشتركي الباقة الذهبية (Gold) والبلاتينية (Platinum).',
      code: 'CART_NOT_PERMITTED'
    };
  }

  const cart = await CandidateCart.findOne({ companyId: company._id }).populate('items.jobId').lean();
  if (!cart || !cart.items || cart.items.length === 0) {
    throw { statusCode: 400, message: 'سلة المرشحين فارغة. يرجى إضافة مسميات وظيفية أولاً.', code: 'CART_EMPTY' };
  }

  if (cart.items.some((item) => !item.jobId || item.jobId.isActive === false)) {
    throw {
      statusCode: 409,
      message: 'يحتوي الطلب على مسمى وظيفي غير نشط. يرجى حذفه أولاً من السلة.',
      code: 'CART_CONTAINS_INACTIVE_JOB'
    };
  }

  const requestedCandidates = cart.items.reduce((sum, item) => (
    sum + Math.min(
      planLimits.maxCandidatesPerTitle || 10,
      Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0 ? Math.floor(Number(item.quantity)) : 10
    )
  ), 0);

  if (cart.items.length > MAX_CART_TITLES || requestedCandidates > MAX_CART_EXPORT_CANDIDATES) {
    throw {
      statusCode: 400,
      message: `التصدير متاح بحد أقصى ${MAX_CART_TITLES} مسميات وظيفية و ${MAX_CART_EXPORT_CANDIDATES} مرشحاً في المرة الواحدة.`,
      code: 'CART_EXPORT_LIMIT_EXCEEDED'
    };
  }

  // 1. Verify download quotas for each included job title
  for (const item of cart.items) {
    const jId = item.jobId?._id || item.jobId;
    await checkAndConsumeDownloadQuota(company._id, jId, 1, req);
  }

  const nowStr = new Date().toISOString().slice(0, 10);

  // =========================================================================
  // OPTION B: ZIP File containing bunch of separate Excel files per job title
  // =========================================================================
  if (format === 'zip') {
    const zip = new JSZip();

    for (const item of cart.items) {
      const job = item.jobId;
      const jId = job?._id || item.jobId;
      const jobName = job?.nameAr || job?.name || 'مسمى وظيفي';
      const careerLevel = (item.careerLevel || '').trim();
      const quantity = Math.min(
        planLimits.maxCandidatesPerTitle || 10,
        Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0 ? Math.floor(Number(item.quantity)) : 10
      );

      const matchQuery = buildCandidateMatchQuery(jId, careerLevel);
      const candidates = await Candidate.find(matchQuery)
        .select('fullName phone governorate area yearsOfExperience qualification careerLevel desiredJobId secondJobId thirdJobId')
        .populate('desiredJobId', 'name nameAr')
        .populate('secondJobId', 'name nameAr')
        .populate('thirdJobId', 'name nameAr')
        .sort({ createdAt: -1 })
        .limit(quantity)
        .lean();

      const rows = candidates.map((c) => formatCandidateRow(c, jobName, careerLevel));
      const singleWb = XLSX.utils.book_new();
      const sheetName = getSafeSheetName(jobName, 'المرشحون');
      const ws = XLSX.utils.json_to_sheet(
        rows.length > 0 ? rows : [{ 'ملاحظة': `لا يوجد مرشحون متاحون حالياً لمسمى ${jobName}${careerLevel ? ` بمستوى ${careerLevel}` : ''}` }]
      );
      XLSX.utils.book_append_sheet(singleWb, ws, sheetName);

      const singleBuffer = XLSX.write(singleWb, { type: 'buffer', bookType: 'xlsx' });
      const safeFilename = `${jobName.replace(/[/\\?%*:|"<>]/g, '_')}${careerLevel ? `_${careerLevel.replace(/[/\\?%*:|"<>]/g, '_')}` : ''}.xlsx`;
      zip.file(safeFilename, singleBuffer);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    await logActivity({
      actorId: company.userId,
      actorRole: 'company',
      companyId: company._id,
      action: 'CART_EXPORTED',
      entityType: 'Cart',
      metadata: {
        format: 'zip',
        titlesCount: cart.items.length,
        cairoDate: new Date().toISOString()
      },
      req
    }).catch(() => {});

    return {
      buffer: zipBuffer,
      filename: `asher_candidates_archive_${nowStr}.zip`,
      contentType: 'application/zip'
    };
  }

  // =========================================================================
  // OPTION A: 1 Excel sheet with pages (each page = 1 job title) OR Single Sheet
  // =========================================================================
  const workbook = XLSX.utils.book_new();
  const allCategorizedRows = [];
  const usedSheetNames = new Set();

  for (const item of cart.items) {
    const job = item.jobId;
    const jId = job?._id || item.jobId;
    const jobName = job?.nameAr || job?.name || 'مسمى وظيفي';
    const careerLevel = (item.careerLevel || '').trim();
    const quantity = Math.min(
      planLimits.maxCandidatesPerTitle || 10,
      Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0 ? Math.floor(Number(item.quantity)) : 10
    );

    const matchQuery = buildCandidateMatchQuery(jId, careerLevel);
    const candidates = await Candidate.find(matchQuery)
      .select('fullName phone governorate area yearsOfExperience qualification careerLevel desiredJobId secondJobId thirdJobId')
      .populate('desiredJobId', 'name nameAr')
      .populate('secondJobId', 'name nameAr')
      .populate('thirdJobId', 'name nameAr')
      .sort({ createdAt: -1 })
      .limit(quantity)
      .lean();

    const rows = candidates.map((c) => formatCandidateRow(c, jobName, careerLevel));

    if (format === 'multi_sheet') {
      let sheetName = getSafeSheetName(jobName, 'مرشحون');
      let counter = 1;
      while (usedSheetNames.has(sheetName)) {
        sheetName = `${sheetName.slice(0, 26)}_${counter++}`;
      }
      usedSheetNames.add(sheetName);

      const worksheet = XLSX.utils.json_to_sheet(
        rows.length > 0 ? rows : [{ 'ملاحظة': `لا يوجد مرشحون متاحون حالياً لمسمى ${jobName}${careerLevel ? ` بمستوى ${careerLevel}` : ''}` }]
      );
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    } else {
      allCategorizedRows.push(...rows);
    }
  }

  if (format === 'single_sheet' || format === 'single_sheet_categorized') {
    const singleWorksheet = XLSX.utils.json_to_sheet(
      allCategorizedRows.length > 0 ? allCategorizedRows : [{ 'ملاحظة': 'لا يوجد مرشحون مطابقون للمسميات المحددة' }]
    );
    XLSX.utils.book_append_sheet(workbook, singleWorksheet, 'كافة المرشحين');
  }

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  await logActivity({
    actorId: company.userId,
    actorRole: 'company',
    companyId: company._id,
    action: 'CART_EXPORTED',
    entityType: 'Cart',
    metadata: {
      format,
      titlesCount: cart.items.length,
      cairoDate: new Date().toISOString()
    },
    req
  }).catch(() => {});

  return {
    buffer,
    filename: `asher_candidates_${format === 'multi_sheet' ? 'multisheet' : 'combined'}_${nowStr}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
}

module.exports = {
  getCart,
  addOrUpdateCartItem,
  removeCartItem,
  clearCart,
  exportCartExcel
};
