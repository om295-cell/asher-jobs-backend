const mongoose = require('mongoose');
const XLSX = require('xlsx');
const CandidateCart = require('../models/CandidateCart');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const { getPlanLimits, checkAndConsumeDownloadQuota } = require('./entitlement.service');
const { logActivity } = require('./activity.service');

/**
 * Retrieve current cart for an employer account with populated job details and available candidate counts
 */
async function getCart(companyId) {
  let cart = await CandidateCart.findOne({ companyId }).populate('items.jobId', 'name nameAr').lean();
  if (!cart) {
    cart = { companyId, items: [] };
  }

  // Enrich with matching available candidate counts
  const enrichedItems = await Promise.all(
    (cart.items || []).map(async (item) => {
      if (!item.jobId) return item;
      const jId = item.jobId._id || item.jobId;

      const availableCount = await Candidate.countDocuments({
        $or: [{ desiredJobId: jId }, { secondJobId: jId }, { thirdJobId: jId }],
        accountStatus: 'active',
        isDeleted: false
      });

      return {
        ...item,
        availableCandidatesCount: availableCount,
        isSufficient: availableCount >= item.quantity
      };
    })
  );

  return {
    ...cart,
    items: enrichedItems
  };
}

/**
 * Add or update an item in the multi-title cart
 */
async function addOrUpdateCartItem(company, { jobId, quantity = 1, notes = '' }) {
  const planLimits = await getPlanLimits(company.subscriptionPlan);
  if (!planLimits.cartEnabled) {
    throw {
      statusCode: 403,
      message: 'خاصية سلة المرشحين المتعددة متاحة فقط لمشتركي الباقة الذهبية (Gold) والبلاتينية (Platinum).',
      code: 'CART_NOT_PERMITTED'
    };
  }

  if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {
    throw { statusCode: 400, message: 'يرجى اختيار مسمى وظيفي صالح.', code: 'INVALID_JOB_ID' };
  }

  const job = await Job.findById(jobId);
  if (!job) {
    throw { statusCode: 404, message: 'المسمى الوظيفي غير موجود.', code: 'JOB_NOT_FOUND' };
  }

  const cleanQuantity = Math.max(1, Math.min(planLimits.maxCandidatesPerTitle, parseInt(quantity, 10) || 1));

  let cart = await CandidateCart.findOne({ companyId: company._id });
  if (!cart) {
    cart = new CandidateCart({ companyId: company._id, items: [] });
  }

  const existingIndex = cart.items.findIndex((item) => String(item.jobId) === String(jobId));
  if (existingIndex > -1) {
    cart.items[existingIndex].quantity = cleanQuantity;
    if (notes !== undefined) cart.items[existingIndex].notes = notes;
  } else {
    cart.items.push({
      jobId,
      quantity: cleanQuantity,
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
function formatCandidateRow(c, jobTitleName) {
  return {
    'Requested Job Title': sanitizeExcelCell(jobTitleName || 'N/A'),
    'Candidate Name': sanitizeExcelCell(c.fullName),
    'Phone Number': sanitizeExcelCell(c.phone),
    'Primary Job': sanitizeExcelCell(c.desiredJobId ? (c.desiredJobId.nameAr || c.desiredJobId.name) : 'N/A'),
    'Career Level': sanitizeExcelCell(c.careerLevel || 'N/A'),
    'Secondary Job': sanitizeExcelCell(c.secondJobId ? (c.secondJobId.nameAr || c.secondJobId.name) : 'None'),
    'Tertiary Job': sanitizeExcelCell(c.thirdJobId ? (c.thirdJobId.nameAr || c.thirdJobId.name) : 'None')
  };
}

/**
 * Export cart candidates in Excel format:
 * Format 1: Multi-sheet workbook (separate sheet per job title)
 * Format 2: Single-sheet categorized workbook (all candidates grouped by job title)
 */
async function exportCartExcel(company, { format = 'multi_sheet' }, req = null) {
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

  // 1. Verify download quotas for each included job title before starting
  for (const item of cart.items) {
    const jId = item.jobId?._id || item.jobId;
    await checkAndConsumeDownloadQuota(company._id, jId, 1, req);
  }

  const workbook = XLSX.utils.book_new();
  const allCategorizedRows = [];

  for (const item of cart.items) {
    const job = item.jobId;
    const jId = job?._id || item.jobId;
    const jobName = job?.nameAr || job?.name || 'Job Title';
    const cleanSheetName = jobName.replace(/[\\/?*[\]]/g, '').slice(0, 30) || 'Candidates';

    const quantity = Math.min(planLimits.maxCandidatesPerTitle, item.quantity || 10);

    const candidates = await Candidate.aggregate([
      {
        $match: {
          $or: [{ desiredJobId: jId }, { secondJobId: jId }, { thirdJobId: jId }],
          accountStatus: 'active',
          isDeleted: false
        }
      },
      {
        $addFields: {
          matchPriority: {
            $cond: [
              { $eq: ['$desiredJobId', jId] },
              1,
              {
                $cond: [
                  { $eq: ['$secondJobId', jId] },
                  2,
                  { $cond: [{ $eq: ['$thirdJobId', jId] }, 3, 4] }
                ]
              }
            ]
          }
        }
      },
      { $sort: { matchPriority: 1, createdAt: -1 } },
      { $limit: quantity }
    ]);

    const populated = await Candidate.populate(candidates, [
      { path: 'desiredJobId', select: 'name nameAr' },
      { path: 'secondJobId', select: 'name nameAr' },
      { path: 'thirdJobId', select: 'name nameAr' }
    ]);

    const rows = populated.map((c) => formatCandidateRow(c, jobName));

    if (format === 'multi_sheet') {
      const worksheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ 'Note': `لا يوجد مرشحون متاحون حالياً لمسمى ${jobName}` }]);
      XLSX.utils.book_append_sheet(workbook, worksheet, cleanSheetName);
    } else {
      allCategorizedRows.push(...rows);
    }
  }

  if (format === 'single_sheet') {
    const singleWorksheet = XLSX.utils.json_to_sheet(
      allCategorizedRows.length > 0 ? allCategorizedRows : [{ 'Note': 'لا يوجد مرشحون مطابقون للمسميات المحددة' }]
    );
    XLSX.utils.book_append_sheet(workbook, singleWorksheet, 'All Candidates');
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
    filename: `candidate-cart-${format}-${Date.now()}.xlsx`
  };
}

module.exports = {
  getCart,
  addOrUpdateCartItem,
  removeCartItem,
  clearCart,
  exportCartExcel
};
