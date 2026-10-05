const mongoose = require("mongoose");
const Job = require("../models/Job");
const JobCategory = require("../models/JobCategory");
const { connectDB, closeDB } = require("../config/db");

const CATEGORIES = [
  { name: "Accounting & Finance",       nameAr: "محاسبة ومالية",               sortOrder: 1 },
  { name: "Warehousing & Logistics",    nameAr: "مخازن ولوجستيات",             sortOrder: 2 },
  { name: "HR & Administration",        nameAr: "موارد بشرية وإدارة",          sortOrder: 3 },
  { name: "Engineering",                nameAr: "هندسة",                        sortOrder: 4 },
  { name: "Quality & Inspection",       nameAr: "جودة وفحص",                   sortOrder: 5 },
  { name: "Maintenance & Technical",    nameAr: "صيانة وفني",                  sortOrder: 6 },
  { name: "Production & Manufacturing", nameAr: "إنتاج وتصنيع",                sortOrder: 7 },
  { name: "Sales & Marketing",          nameAr: "مبيعات وتسويق",               sortOrder: 8 },
  { name: "Drivers & Logistics",        nameAr: "سائقين وخدمات لوجستية",       sortOrder: 9 },
  { name: "Specialized & Other",        nameAr: "تخصصات أخرى",                 sortOrder: 10 },
];

const JOBS = [
  // Accounting & Finance (4)
  { cat: "Accounting & Finance",       name: "Financial Accountant",              nameAr: "محاسب مالي" },
  { cat: "Accounting & Finance",       name: "Cost Accountant",                   nameAr: "محاسب تكاليف" },
  { cat: "Accounting & Finance",       name: "Auditor",                           nameAr: "مراجع حسابات" },
  { cat: "Accounting & Finance",       name: "Cashier",                           nameAr: "كاشير" },
  // Warehousing & Logistics (8)
  { cat: "Warehousing & Logistics",    name: "Storekeeper",                       nameAr: "أمين مخزن" },
  { cat: "Warehousing & Logistics",    name: "Procurement Officer",               nameAr: "موظف توريدات" },
  { cat: "Warehousing & Logistics",    name: "Purchasing Manager",                nameAr: "مدير مشتريات" },
  { cat: "Warehousing & Logistics",    name: "Shipping Officer",                  nameAr: "موظف شحن" },
  { cat: "Warehousing & Logistics",    name: "Customs Clearance Agent",           nameAr: "مخلص جمركي" },
  { cat: "Warehousing & Logistics",    name: "Import Specialist",                 nameAr: "أخصائي استيراد" },
  { cat: "Warehousing & Logistics",    name: "Export Manager",                    nameAr: "مدير تصدير" },
  { cat: "Warehousing & Logistics",    name: "Warehouse Worker",                  nameAr: "عامل مخازن" },
  // HR & Administration (13)
  { cat: "HR & Administration",        name: "HR Specialist",                     nameAr: "أخصائي موارد بشرية" },
  { cat: "HR & Administration",        name: "Recruitment Officer",               nameAr: "مسؤول توظيف" },
  { cat: "HR & Administration",        name: "Secretary",                         nameAr: "سكرتارية" },
  { cat: "HR & Administration",        name: "Receptionist",                      nameAr: "موظف استقبال" },
  { cat: "HR & Administration",        name: "Data Entry Operator",               nameAr: "مدخل بيانات" },
  { cat: "HR & Administration",        name: "Administrative Officer",            nameAr: "موظف إداري" },
  { cat: "HR & Administration",        name: "Personnel Affairs Officer",         nameAr: "موظف شؤون عاملين" },
  { cat: "HR & Administration",        name: "Training Specialist",               nameAr: "أخصائي تدريب" },
  { cat: "HR & Administration",        name: "Operations Coordinator",            nameAr: "منسق عمليات" },
  { cat: "HR & Administration",        name: "Project Manager",                   nameAr: "مدير مشروع" },
  { cat: "HR & Administration",        name: "Assistant Manager",                 nameAr: "مساعد مدير" },
  { cat: "HR & Administration",        name: "Factory Manager",                   nameAr: "مدير مصنع" },
  { cat: "HR & Administration",        name: "Timekeeper",                        nameAr: "مراقب وقت (Timekeeper)" },
  // Engineering (13)
  { cat: "Engineering",                name: "Production Engineer",               nameAr: "مهندس إنتاج" },
  { cat: "Engineering",                name: "Quality Engineer",                  nameAr: "مهندس جودة" },
  { cat: "Engineering",                name: "Mechanical Engineer",               nameAr: "مهندس ميكانيكا" },
  { cat: "Engineering",                name: "Electrical Engineer",               nameAr: "مهندس كهرباء" },
  { cat: "Engineering",                name: "Sales Engineer",                    nameAr: "مهندس مبيعات" },
  { cat: "Engineering",                name: "Civil Engineer",                    nameAr: "مهندس مدني" },
  { cat: "Engineering",                name: "Architectural Engineer",            nameAr: "مهندس معمار" },
  { cat: "Engineering",                name: "Technical Office Engineer",         nameAr: "مهندس مكتب فني" },
  { cat: "Engineering",                name: "Agricultural Engineer",             nameAr: "مهندس زراعي" },
  { cat: "Engineering",                name: "Web Developer",                     nameAr: "مطور ويب" },
  { cat: "Engineering",                name: "Flutter Developer",                 nameAr: "مطور تطبيقات (Flutter)" },
  { cat: "Engineering",                name: "Programmer",                        nameAr: "مبرمج" },
  { cat: "Engineering",                name: "IT Support Specialist",             nameAr: "أخصائي دعم فني" },
  // Quality & Inspection (3)
  { cat: "Quality & Inspection",       name: "Quality Controller",                nameAr: "مراقب جودة" },
  { cat: "Quality & Inspection",       name: "Lab Technician",                    nameAr: "فني معمل" },
  { cat: "Quality & Inspection",       name: "Chemist",                           nameAr: "كيميائي" },
  // Maintenance & Technical (24)
  { cat: "Maintenance & Technical",    name: "Mechanical Maintenance Technician", nameAr: "فني صيانة ميكانيكية" },
  { cat: "Maintenance & Technical",    name: "Electrical Technician",             nameAr: "فني كهرباء" },
  { cat: "Maintenance & Technical",    name: "HVAC Technician",                   nameAr: "فني تبريد وتكييف" },
  { cat: "Maintenance & Technical",    name: "Plumbing Technician",               nameAr: "فني سباكة" },
  { cat: "Maintenance & Technical",    name: "Welding Technician",                nameAr: "فني لحام" },
  { cat: "Maintenance & Technical",    name: "OHS Technician",                    nameAr: "فني سلامة وصحة مهنية" },
  { cat: "Maintenance & Technical",    name: "OHS Specialist",                    nameAr: "أخصائي سلامة وصحة مهنية" },
  { cat: "Maintenance & Technical",    name: "Machine Operator Technician",       nameAr: "فني تشغيل ماكينات" },
  { cat: "Maintenance & Technical",    name: "Printing Technician",               nameAr: "فني طباعة" },
  { cat: "Maintenance & Technical",    name: "Carpentry Technician",              nameAr: "فني نجارة" },
  { cat: "Maintenance & Technical",    name: "Blacksmith Technician",             nameAr: "فني حدادة" },
  { cat: "Maintenance & Technical",    name: "Alumetal Technician",               nameAr: "فني ألوميتال" },
  { cat: "Maintenance & Technical",    name: "Sewing Technician",                 nameAr: "فني خياطة" },
  { cat: "Maintenance & Technical",    name: "Cutting Technician",                nameAr: "فني قص" },
  { cat: "Maintenance & Technical",    name: "Garment Finishing Technician",      nameAr: "فني تشطيب ملابس" },
  { cat: "Maintenance & Technical",    name: "Embroidery Technician",             nameAr: "فني تطريز" },
  { cat: "Maintenance & Technical",    name: "Textile Technician",                nameAr: "فني نسيج" },
  { cat: "Maintenance & Technical",    name: "Dyeing Technician",                 nameAr: "فني صباغة" },
  { cat: "Maintenance & Technical",    name: "Installation Technician",           nameAr: "فني تركيبات" },
  { cat: "Maintenance & Technical",    name: "Elevator Technician",               nameAr: "فني مصاعد" },
  { cat: "Maintenance & Technical",    name: "Boiler Technician",                 nameAr: "فني غلايات" },
  { cat: "Maintenance & Technical",    name: "Air Compressor Technician",         nameAr: "فني ضواغط هواء" },
  { cat: "Maintenance & Technical",    name: "Hydraulics Technician",             nameAr: "فني هيدروليك" },
  { cat: "Maintenance & Technical",    name: "Electronics Technician",            nameAr: "فني إلكترونيات" },
  // Production & Manufacturing (10)
  { cat: "Production & Manufacturing", name: "Production Worker",                 nameAr: "عامل إنتاج" },
  { cat: "Production & Manufacturing", name: "Packing Worker",                    nameAr: "عامل تعبئة وتغليف" },
  { cat: "Production & Manufacturing", name: "Services Worker",                   nameAr: "عامل خدمات" },
  { cat: "Production & Manufacturing", name: "Buffet Staff",                      nameAr: "موظف بوفيه" },
  { cat: "Production & Manufacturing", name: "Security Guard",                    nameAr: "فرد أمن" },
  { cat: "Production & Manufacturing", name: "Security Supervisor",               nameAr: "مشرف أمن" },
  { cat: "Production & Manufacturing", name: "Workers Supervisor",                nameAr: "مشرف عمال" },
  { cat: "Production & Manufacturing", name: "Cleaning Worker",                   nameAr: "عامل نظافة" },
  { cat: "Production & Manufacturing", name: "Graphic Designer",                  nameAr: "مصمم جرافيك" },
  { cat: "Production & Manufacturing", name: "Content Writer",                    nameAr: "كاتب محتوى" },
  // Sales & Marketing (11)
  { cat: "Sales & Marketing",          name: "Sales Representative",              nameAr: "مندوب مبيعات" },
  { cat: "Sales & Marketing",          name: "Sales Supervisor",                  nameAr: "مشرف مبيعات" },
  { cat: "Sales & Marketing",          name: "Sales Manager",                     nameAr: "مدير مبيعات" },
  { cat: "Sales & Marketing",          name: "Indoor Sales Officer",              nameAr: "موظف مبيعات داخلية" },
  { cat: "Sales & Marketing",          name: "Clothing Salesperson",              nameAr: "بائع ملابس" },
  { cat: "Sales & Marketing",          name: "Aisle Coordinator",                 nameAr: "منسق ممرات" },
  { cat: "Sales & Marketing",          name: "Branch Manager",                    nameAr: "مدير فرع" },
  { cat: "Sales & Marketing",          name: "Marketing Specialist",              nameAr: "أخصائي تسويق" },
  { cat: "Sales & Marketing",          name: "Medical Rep",                       nameAr: "مندوب دعاية طبية" },
  { cat: "Sales & Marketing",          name: "Customer Service Officer",          nameAr: "موظف خدمة عملاء" },
  { cat: "Sales & Marketing",          name: "Public Relations Officer",          nameAr: "مسؤول علاقات عامة" },
  // Drivers & Logistics (5)
  { cat: "Drivers & Logistics",        name: "Reach Truck Driver",                nameAr: "سائق ريتش تراك" },
  { cat: "Drivers & Logistics",        name: "Forklift Driver",                   nameAr: "سائق كلارك" },
  { cat: "Drivers & Logistics",        name: "First License Driver",              nameAr: "سائق رخصة أولى" },
  { cat: "Drivers & Logistics",        name: "Second License Driver",             nameAr: "سائق رخصة ثانية" },
  { cat: "Drivers & Logistics",        name: "Third License Driver",              nameAr: "سائق رخصة ثالثة" },
  // Specialized & Other (9)
  { cat: "Specialized & Other",        name: "Veterinarian",                      nameAr: "طبيب بيطري" },
  { cat: "Specialized & Other",        name: "Pharmacist",                        nameAr: "صيدلي" },
  { cat: "Specialized & Other",        name: "Pharmacy Assistant",                nameAr: "مساعد صيدلي" },
  { cat: "Specialized & Other",        name: "Nurse",                             nameAr: "ممرض" },
  { cat: "Specialized & Other",        name: "Lawyer",                            nameAr: "محامي" },
  { cat: "Specialized & Other",        name: "Legal Specialist",                  nameAr: "أخصائي قانوني" },
  { cat: "Specialized & Other",        name: "Translator",                        nameAr: "مترجم" },
  { cat: "Specialized & Other",        name: "Teacher",                           nameAr: "مدرس" },
  { cat: "Specialized & Other",        name: "Trainer",                           nameAr: "مدرب" },
];

async function run() {
  await connectDB();

  console.log("Wiping existing categories and jobs...");
  await Job.deleteMany({});
  await JobCategory.deleteMany({});

  console.log("Inserting 10 categories...");
  const catDocs = await JobCategory.insertMany(CATEGORIES);
  const catMap = {};
  catDocs.forEach(doc => { catMap[doc.name] = doc._id; });

  console.log("Inserting job titles...");
  const jobDocs = JOBS.map((j, i) => ({
    name: j.name,
    nameAr: j.nameAr,
    categoryId: catMap[j.cat],
    isActive: true,
    sortOrder: i + 1,
  }));
  const inserted = await Job.insertMany(jobDocs);

  console.log("Categories: " + catDocs.length);
  console.log("Jobs: " + inserted.length);
  console.log("Done.");
  await closeDB();
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
