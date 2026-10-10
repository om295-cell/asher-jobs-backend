const JobCategory = require('../models/JobCategory');
const { normalizeForComparison } = require('./titleExtraction.service');

// Standard categories with bilingual labels
const STANDARD_CATEGORIES = {
  ACCOUNTING: { name: 'Accounting & Finance', nameAr: 'محاسبة ومالية', sortOrder: 1 },
  WAREHOUSING: { name: 'Warehousing & Logistics', nameAr: 'مخازن ولوجستيات', sortOrder: 2 },
  HR_ADMIN: { name: 'HR & Administration', nameAr: 'موارد بشرية وإدارة', sortOrder: 3 },
  ENGINEERING: { name: 'Engineering', nameAr: 'هندسة', sortOrder: 4 },
  QUALITY: { name: 'Quality & Inspection', nameAr: 'جودة وفحص', sortOrder: 5 },
  MAINTENANCE: { name: 'Maintenance & Technical', nameAr: 'صيانة وفني', sortOrder: 6 },
  PRODUCTION: { name: 'Production & Manufacturing', nameAr: 'إنتاج وتصنيع', sortOrder: 7 },
  SALES_MARKETING: { name: 'Sales & Marketing', nameAr: 'مبيعات وتسويق', sortOrder: 8 },
  DRIVERS: { name: 'Drivers & Logistics', nameAr: 'سائقين وخدمات لوجستية', sortOrder: 9 },
  SPECIALIZED: { name: 'Specialized & Other', nameAr: 'تخصصات أخرى', sortOrder: 10 }
};

// Known exact titles mapping (from Asher Jobs catalog)
const EXACT_TITLE_TO_CATEGORY_KEY = {
  // Accounting & Finance
  'محاسب مالي': 'ACCOUNTING',
  'financial accountant': 'ACCOUNTING',
  'محاسب تكاليف': 'ACCOUNTING',
  'cost accountant': 'ACCOUNTING',
  'مراجع حسابات': 'ACCOUNTING',
  'auditor': 'ACCOUNTING',
  'كاشير': 'ACCOUNTING',
  'cashier': 'ACCOUNTING',

  // Warehousing & Logistics
  'أمين مخزن': 'WAREHOUSING',
  'amin makhzan': 'WAREHOUSING',
  'storekeeper': 'WAREHOUSING',
  'موظف توريدات': 'WAREHOUSING',
  'procurement officer': 'WAREHOUSING',
  'مدير مشتريات': 'WAREHOUSING',
  'purchasing manager': 'WAREHOUSING',
  'موظف شحن': 'WAREHOUSING',
  'shipping officer': 'WAREHOUSING',
  'مخلص جمركي': 'WAREHOUSING',
  'customs clearance agent': 'WAREHOUSING',
  'أخصائي استيراد': 'WAREHOUSING',
  'import specialist': 'WAREHOUSING',
  'مدير تصدير': 'WAREHOUSING',
  'export manager': 'WAREHOUSING',
  'عامل مخازن': 'WAREHOUSING',
  'warehouse worker': 'WAREHOUSING',

  // HR & Administration
  'أخصائي موارد بشرية': 'HR_ADMIN',
  'hr specialist': 'HR_ADMIN',
  'مسؤول توظيف': 'HR_ADMIN',
  'recruitment officer': 'HR_ADMIN',
  'سكرتارية': 'HR_ADMIN',
  'secretary': 'HR_ADMIN',
  'موظف استقبال': 'HR_ADMIN',
  'receptionist': 'HR_ADMIN',
  'مدخل بيانات': 'HR_ADMIN',
  'data entry operator': 'HR_ADMIN',
  'موظف إداري': 'HR_ADMIN',
  'administrative officer': 'HR_ADMIN',
  'موظف شؤون عاملين': 'HR_ADMIN',
  'personnel affairs officer': 'HR_ADMIN',
  'أخصائي تدريب': 'HR_ADMIN',
  'training specialist': 'HR_ADMIN',
  'منسق عمليات': 'HR_ADMIN',
  'operations coordinator': 'HR_ADMIN',
  'مدير مشروع': 'HR_ADMIN',
  'project manager': 'HR_ADMIN',
  'مساعد مدير': 'HR_ADMIN',
  'assistant manager': 'HR_ADMIN',
  'مدير مصنع': 'HR_ADMIN',
  'factory manager': 'HR_ADMIN',
  'مراقب وقت': 'HR_ADMIN',
  'timekeeper': 'HR_ADMIN',

  // Engineering
  'مهندس إنتاج': 'ENGINEERING',
  'production engineer': 'ENGINEERING',
  'مهندس جودة': 'ENGINEERING',
  'quality engineer': 'ENGINEERING',
  'مهندس ميكانيكا': 'ENGINEERING',
  'mechanical engineer': 'ENGINEERING',
  'مهندس كهرباء': 'ENGINEERING',
  'electrical engineer': 'ENGINEERING',
  'مهندس مبيعات': 'ENGINEERING',
  'sales engineer': 'ENGINEERING',
  'مهندس مدني': 'ENGINEERING',
  'civil engineer': 'ENGINEERING',
  'مهندس معمار': 'ENGINEERING',
  'architectural engineer': 'ENGINEERING',
  'مهندس مكتب فني': 'ENGINEERING',
  'technical office engineer': 'ENGINEERING',
  'مهندس زراعي': 'ENGINEERING',
  'agricultural engineer': 'ENGINEERING',
  'مطور ويب': 'ENGINEERING',
  'web developer': 'ENGINEERING',
  'مطور تطبيقات': 'ENGINEERING',
  'flutter developer': 'ENGINEERING',
  'مبرمج': 'ENGINEERING',
  'programmer': 'ENGINEERING',
  'أخصائي دعم فني': 'ENGINEERING',
  'it support specialist': 'ENGINEERING',

  // Quality & Inspection
  'مراقب جودة': 'QUALITY',
  'quality controller': 'QUALITY',
  'فني معمل': 'QUALITY',
  'lab technician': 'QUALITY',
  'كيميائي': 'QUALITY',
  'chemist': 'QUALITY',

  // Maintenance & Technical
  'فني صيانة ميكانيكية': 'MAINTENANCE',
  'فني كهرباء': 'MAINTENANCE',
  'فني تبريد وتكييف': 'MAINTENANCE',
  'فني سباكة': 'MAINTENANCE',
  'فني لحام': 'MAINTENANCE',
  'فني سلامة وصحة مهنية': 'MAINTENANCE',
  'أخصائي سلامة وصحة مهنية': 'MAINTENANCE',
  'فني تشغيل ماكينات': 'MAINTENANCE',
  'فني طباعة': 'MAINTENANCE',
  'فني نجارة': 'MAINTENANCE',
  'فني حدادة': 'MAINTENANCE',
  'فني ألوميتال': 'MAINTENANCE',
  'فني خياطة': 'MAINTENANCE',
  'فني قص': 'MAINTENANCE',
  'فني تشطيب ملابس': 'MAINTENANCE',
  'فني تطريز': 'MAINTENANCE',
  'فني نسيج': 'MAINTENANCE',
  'فني صباغة': 'MAINTENANCE',
  'فني تركيبات': 'MAINTENANCE',
  'فني مصاعد': 'MAINTENANCE',
  'فني غلايات': 'MAINTENANCE',
  'فني ضواغط هواء': 'MAINTENANCE',
  'فني هيدروليك': 'MAINTENANCE',
  'فني إلكترونيات': 'MAINTENANCE',

  // Production & Manufacturing
  'عامل إنتاج': 'PRODUCTION',
  'production worker': 'PRODUCTION',
  'عامل تعبئة وتغليف': 'PRODUCTION',
  'packing worker': 'PRODUCTION',
  'عامل خدمات': 'PRODUCTION',
  'services worker': 'PRODUCTION',
  'موظف بوفيه': 'PRODUCTION',
  'buffet staff': 'PRODUCTION',
  'فرد أمن': 'PRODUCTION',
  'security guard': 'PRODUCTION',
  'مشرف أمن': 'PRODUCTION',
  'security supervisor': 'PRODUCTION',
  'مشرف عمال': 'PRODUCTION',
  'workers supervisor': 'PRODUCTION',
  'عامل نظافة': 'PRODUCTION',
  'cleaning worker': 'PRODUCTION',
  'مصمم جرافيك': 'PRODUCTION',
  'graphic designer': 'PRODUCTION',
  'كاتب محتوى': 'PRODUCTION',
  'content writer': 'PRODUCTION',

  // Sales & Marketing
  'مندوب مبيعات': 'SALES_MARKETING',
  'sales representative': 'SALES_MARKETING',
  'مشرف مبيعات': 'SALES_MARKETING',
  'sales supervisor': 'SALES_MARKETING',
  'مدير مبيعات': 'SALES_MARKETING',
  'sales manager': 'SALES_MARKETING',
  'موظف مبيعات داخلية': 'SALES_MARKETING',
  'indoor sales officer': 'SALES_MARKETING',
  'بائع ملابس': 'SALES_MARKETING',
  'clothing salesperson': 'SALES_MARKETING',
  'منسق ممرات': 'SALES_MARKETING',
  'aisle coordinator': 'SALES_MARKETING',
  'مدير فرع': 'SALES_MARKETING',
  'branch manager': 'SALES_MARKETING',
  'أخصائي تسويق': 'SALES_MARKETING',
  'marketing specialist': 'SALES_MARKETING',
  'مندوب دعاية طبية': 'SALES_MARKETING',
  'medical rep': 'SALES_MARKETING',
  'موظف خدمة عملاء': 'SALES_MARKETING',
  'customer service officer': 'SALES_MARKETING',
  'مسؤول علاقات عامة': 'SALES_MARKETING',
  'public relations officer': 'SALES_MARKETING',

  // Drivers & Logistics
  'سائق ريتش تراك': 'DRIVERS',
  'reach truck driver': 'DRIVERS',
  'سائق كلارك': 'DRIVERS',
  'forklift driver': 'DRIVERS',
  'سائق رخصة أولى': 'DRIVERS',
  'first license driver': 'DRIVERS',
  'سائق رخصة ثانية': 'DRIVERS',
  'second license driver': 'DRIVERS',
  'سائق رخصة ثالثة': 'DRIVERS',
  'third license driver': 'DRIVERS',

  // Specialized & Other
  'طبيب بيطري': 'SPECIALIZED',
  'veterinarian': 'SPECIALIZED',
  'صيدلي': 'SPECIALIZED',
  'pharmacist': 'SPECIALIZED',
  'مساعد صيدلي': 'SPECIALIZED',
  'pharmacy assistant': 'SPECIALIZED',
  'ممرض': 'SPECIALIZED',
  'nurse': 'SPECIALIZED',
  'محامي': 'SPECIALIZED',
  'lawyer': 'SPECIALIZED',
  'أخصائي قانوني': 'SPECIALIZED',
  'legal specialist': 'SPECIALIZED',
  'مترجم': 'SPECIALIZED',
  'translator': 'SPECIALIZED',
  'مدرس': 'SPECIALIZED',
  'teacher': 'SPECIALIZED',
  'مدرب': 'SPECIALIZED',
  'trainer': 'SPECIALIZED'
};

// Normalized exact map for rapid lookup
const NORMALIZED_EXACT_MAP = new Map();
for (const [title, catKey] of Object.entries(EXACT_TITLE_TO_CATEGORY_KEY)) {
  NORMALIZED_EXACT_MAP.set(normalizeForComparison(title), catKey);
}

// Keyword-based pattern rules
const KEYWORD_RULES = [
  // Engineering & IT
  {
    regex: /(مهندس|مطور|مبرمج|برمج|برمجة|شبكات|it|software|hardware|developer|programmer|engineer|flutter|react|fullstack|devops)/i,
    categoryKey: 'ENGINEERING'
  },
  // Maintenance & Technical
  {
    regex: /(فني|صيانة|كهربا|تبريد|تكييف|سباك|لحام|حداد|نجار|الوميتال|ألوميتال|خياط|قص|نسيج|صباغ|تركيبات|مصاعد|غلاي|هيدروليك|إلكترون|technician|electrician|plumber|welder|maintenance|machinist|mechanic)/i,
    categoryKey: 'MAINTENANCE'
  },
  // Drivers
  {
    regex: /(سائق|كلارك|ريتش تراك|فوركلفت|رخصة|شاحنة|اتوبيس|باص|driver|forklift|truck)/i,
    categoryKey: 'DRIVERS'
  },
  // Accounting & Finance
  {
    regex: /(محاسب|حسابات|مالي|تكاليف|مراجع|كاشير|ضرائب|خزين|موازنة|ميزانية|accountant|accounting|auditor|cashier|finance|financial|payroll|tax)/i,
    categoryKey: 'ACCOUNTING'
  },
  // Warehousing & Logistics
  {
    regex: /(مخزن|مخازن|توريد|مشتريات|شحن|جمرك|تخليص|استيراد|تصدير|مستودع|warehouse|storekeeper|procurement|purchasing|shipping|customs|import|export|logistics)/i,
    categoryKey: 'WAREHOUSING'
  },
  // HR & Administration
  {
    regex: /(موارد بشرية|توظيف|سكرتار|استقبال|مدخل بيانات|إداري|اداري|شؤون عاملين|تدريب|شؤون|علاقات عامة|مراقب وقت|timekeeper|منسق عمليات|hr|recruitment|recruiter|secretary|receptionist|data entry|administrative|office manager)/i,
    categoryKey: 'HR_ADMIN'
  },
  // Quality & Inspection
  {
    regex: /(جودة|فحص|معمل|مختبر|كيميائ|quality|qc|qa|inspection|inspector|lab|chemist)/i,
    categoryKey: 'QUALITY'
  },
  // Sales & Marketing
  {
    regex: /(مبيعات|تسويق|بائع|ممرات|خدمة عملاء|كول سنتر|دعاية|sales|marketing|seller|customer service|call center|telesales|retail)/i,
    categoryKey: 'SALES_MARKETING'
  },
  // Production & Manufacturing
  {
    regex: /(إنتاج|انتاج|تعبئة|تغليف|خدمات|بوفيه|أمن|حراس|نظافة|مشرف عمال|عامل|مصمم|كاتب محتوى|production|manufacturing|packaging|security|cleaning|cleaner|worker)/i,
    categoryKey: 'PRODUCTION'
  },
  // Specialized & Healthcare & Legal & Education
  {
    regex: /(طبيب|بيطر|صيدل|تمريض|ممرض|محام|قانون|مترجم|مدرس|معلم|مدرب|doctor|pharmacist|nurse|lawyer|legal|translator|teacher|instructor|trainer)/i,
    categoryKey: 'SPECIALIZED'
  }
];

/**
 * Predicts the category definition for a job title based on exact matches or keyword rules.
 */
function inferCategoryDefinition(title) {
  if (!title || typeof title !== 'string') return STANDARD_CATEGORIES.SPECIALIZED;

  const normalized = normalizeForComparison(title);

  // 1. Direct exact lookup
  if (NORMALIZED_EXACT_MAP.has(normalized)) {
    const key = NORMALIZED_EXACT_MAP.get(normalized);
    return STANDARD_CATEGORIES[key] || STANDARD_CATEGORIES.SPECIALIZED;
  }

  // 2. Keyword rules
  for (const rule of KEYWORD_RULES) {
    if (rule.regex.test(title) || rule.regex.test(normalized)) {
      return STANDARD_CATEGORIES[rule.categoryKey] || STANDARD_CATEGORIES.SPECIALIZED;
    }
  }

  // 3. Fallback to Specialized & Other
  return STANDARD_CATEGORIES.SPECIALIZED;
}

/**
 * Ensures all standard categories exist in the database and returns a Map keyed by normalized name and nameAr.
 */
async function getCategoryCache() {
  const existingCategories = await JobCategory.find({}).lean();
  const cache = new Map();

  for (const cat of existingCategories) {
    if (cat.name) cache.set(normalizeForComparison(cat.name), cat);
    if (cat.nameAr) cache.set(normalizeForComparison(cat.nameAr), cat);
  }

  return {
    cache,
    find(catDef) {
      const byName = cache.get(normalizeForComparison(catDef.name));
      if (byName) return byName;
      const byNameAr = cache.get(normalizeForComparison(catDef.nameAr));
      if (byNameAr) return byNameAr;
      return null;
    },
    async getOrCreate(catDef) {
      const existing = this.find(catDef);
      if (existing) return existing;

      try {
        const created = await JobCategory.create({
          name: catDef.name,
          nameAr: catDef.nameAr,
          sortOrder: catDef.sortOrder || 99,
          description: `Automatically created category for ${catDef.name}`,
          isActive: true
        });
        const doc = created.toObject ? created.toObject() : created;
        cache.set(normalizeForComparison(doc.name), doc);
        cache.set(normalizeForComparison(doc.nameAr), doc);
        return doc;
      } catch (err) {
        if (err.code === 11000) {
          const found = await JobCategory.findOne({
            $or: [{ name: catDef.name }, { nameAr: catDef.nameAr }]
          }).lean();
          if (found) {
            cache.set(normalizeForComparison(found.name), found);
            cache.set(normalizeForComparison(found.nameAr), found);
            return found;
          }
        }
        throw err;
      }
    }
  };
}

/**
 * Resolves or automatically creates the right category for a given job title.
 * @param {string} title
 * @param {object} categoryCache - cache returned by getCategoryCache()
 * @returns {Promise<ObjectId>} categoryId
 */
async function resolveCategoryForTitle(title, categoryCache) {
  const matchedDef = inferCategoryDefinition(title);
  const category = await categoryCache.getOrCreate(matchedDef);
  return category._id;
}

module.exports = {
  STANDARD_CATEGORIES,
  inferCategoryDefinition,
  getCategoryCache,
  resolveCategoryForTitle
};
