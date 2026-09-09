import { Router } from "express";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const GENDER_AR: Record<string, string> = { MALE: "ذكر", FEMALE: "أنثى" };
const MARITAL_AR: Record<string, string> = {
  SINGLE: "أعزب",
  MARRIED: "متزوج",
  DIVORCED: "مطلق",
  WIDOWED: "أرمل",
};
const FILE_STATUS_AR: Record<string, string> = { ACTIVE: "نشط", SUSPENDED: "موقوف", CLOSED: "مغلق" };
const CASH_TYPE_AR: Record<string, string> = {
  MONTHLY: "شهري",
  EMERGENCY: "طارئ",
  SEASONAL: "موسمي",
  OTHER: "أخرى",
};
const IN_KIND_CATEGORY_AR: Record<string, string> = {
  FOOD: "مواد غذائية",
  CLOTHING: "ملابس",
  FURNITURE: "أثاث",
  DEVICES: "أجهزة",
  MEDICAL: "مستلزمات طبية",
  SCHOOL: "مستلزمات مدرسية",
  OTHER: "أخرى",
};
const COURSE_CATEGORY_AR: Record<string, string> = {
  COMPUTER: "حاسب آلي",
  LANGUAGES: "لغات",
  AI: "ذكاء اصطناعي",
  LIFE_SKILLS: "مهارات حياتية",
  OTHER: "أخرى",
};

function styleHeader(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ rightToLeft: true }];
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { horizontal: "center", vertical: "middle" };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
    cell.border = { bottom: { style: "thin" } };
  });
  sheet.columns.forEach((col) => (col.alignment = { horizontal: "right" }));
}

async function sendWorkbook(res: any, workbook: ExcelJS.Workbook, filename: string) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  const encoded = encodeURIComponent(filename);
  res.setHeader("Content-Disposition", `attachment; filename="report.xlsx"; filename*=UTF-8''${encoded}`);
  await workbook.xlsx.write(res);
  res.end();
}

// ملخص سريع لعرضه في لوحة التحكم (JSON)
reportsRouter.get("/summary", async (req, res) => {
  const { year } = req.query as Record<string, string>;
  const y = year ? parseInt(year, 10) : new Date().getFullYear();

  const [beneficiariesCount, activeCount, cash, inKind, coursesCount, enrollmentsCount] = await Promise.all([
    prisma.beneficiary.count(),
    prisma.beneficiary.count({ where: { fileStatus: "ACTIVE" } }),
    prisma.cashSupport.aggregate({ where: { year: y }, _sum: { amount: true }, _count: true }),
    prisma.inKindSupport.aggregate({ where: { year: y }, _sum: { estimatedValue: true }, _count: true }),
    prisma.course.count(),
    prisma.courseEnrollment.count(),
  ]);

  res.json({
    year: y,
    beneficiariesCount,
    activeCount,
    cashTotal: cash._sum.amount ?? 0,
    cashCount: cash._count,
    inKindTotal: inKind._sum.estimatedValue ?? 0,
    inKindCount: inKind._count,
    coursesCount,
    enrollmentsCount,
  });
});

// تقرير المستفيدين
reportsRouter.get("/beneficiaries.xlsx", async (req, res) => {
  const { status } = req.query as Record<string, string>;
  const where: any = {};
  if (status) where.fileStatus = status;

  const items = await prisma.beneficiary.findMany({ where, orderBy: { fullName: "asc" } });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("المستفيدون");
  sheet.columns = [
    { header: "رقم الهوية", key: "nationalId", width: 16 },
    { header: "الاسم", key: "fullName", width: 26 },
    { header: "الجنس", key: "gender", width: 10 },
    { header: "الحالة الاجتماعية", key: "maritalStatus", width: 16 },
    { header: "عدد أفراد الأسرة", key: "familyMembersCount", width: 14 },
    { header: "الدخل الشهري", key: "monthlyIncome", width: 14 },
    { header: "الحي", key: "neighborhood", width: 16 },
    { header: "الجوال", key: "phone", width: 14 },
    { header: "تصنيف الاحتياج", key: "needCategory", width: 18 },
    { header: "حالة الملف", key: "fileStatus", width: 12 },
  ];
  items.forEach((b) => {
    sheet.addRow({
      nationalId: b.nationalId,
      fullName: b.fullName,
      gender: GENDER_AR[b.gender] ?? b.gender,
      maritalStatus: b.maritalStatus ? MARITAL_AR[b.maritalStatus] : "",
      familyMembersCount: b.familyMembersCount ?? "",
      monthlyIncome: b.monthlyIncome ?? "",
      neighborhood: b.neighborhood ?? "",
      phone: b.phone ?? "",
      needCategory: b.needCategory ?? "",
      fileStatus: FILE_STATUS_AR[b.fileStatus] ?? b.fileStatus,
    });
  });
  styleHeader(sheet);
  await sendWorkbook(res, workbook, "تقرير_المستفيدين.xlsx");
});

// تقرير الدعم النقدي السنوي
reportsRouter.get("/cash-supports.xlsx", async (req, res) => {
  const { year } = req.query as Record<string, string>;
  const where: any = {};
  if (year) where.year = parseInt(year, 10);

  const items = await prisma.cashSupport.findMany({
    where,
    include: { beneficiary: true },
    orderBy: { supportDate: "asc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("الدعم النقدي");
  sheet.columns = [
    { header: "رقم الهوية", key: "nationalId", width: 16 },
    { header: "اسم المستفيد", key: "fullName", width: 26 },
    { header: "نوع الدعم", key: "type", width: 12 },
    { header: "المبلغ (ريال)", key: "amount", width: 14 },
    { header: "تاريخ الصرف", key: "supportDate", width: 14 },
    { header: "السنة", key: "year", width: 8 },
    { header: "ملاحظات", key: "notes", width: 24 },
  ];
  items.forEach((c) => {
    sheet.addRow({
      nationalId: c.beneficiary.nationalId,
      fullName: c.beneficiary.fullName,
      type: CASH_TYPE_AR[c.type] ?? c.type,
      amount: c.amount,
      supportDate: c.supportDate.toISOString().slice(0, 10),
      year: c.year,
      notes: c.notes ?? "",
    });
  });
  sheet.addRow({});
  const totalRow = sheet.addRow({ fullName: "الإجمالي", amount: items.reduce((s, c) => s + c.amount, 0) });
  totalRow.font = { bold: true };
  styleHeader(sheet);
  await sendWorkbook(res, workbook, "تقرير_الدعم_النقدي.xlsx");
});

// تقرير الدعم العيني السنوي
reportsRouter.get("/in-kind-supports.xlsx", async (req, res) => {
  const { year } = req.query as Record<string, string>;
  const where: any = {};
  if (year) where.year = parseInt(year, 10);

  const items = await prisma.inKindSupport.findMany({
    where,
    include: { beneficiary: true },
    orderBy: { supportDate: "asc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("الدعم العيني");
  sheet.columns = [
    { header: "رقم الهوية", key: "nationalId", width: 16 },
    { header: "اسم المستفيد", key: "fullName", width: 26 },
    { header: "التصنيف", key: "category", width: 16 },
    { header: "الوصف", key: "description", width: 26 },
    { header: "الكمية", key: "quantity", width: 10 },
    { header: "القيمة التقديرية", key: "estimatedValue", width: 16 },
    { header: "تاريخ التسليم", key: "supportDate", width: 14 },
    { header: "السنة", key: "year", width: 8 },
  ];
  items.forEach((s) => {
    sheet.addRow({
      nationalId: s.beneficiary.nationalId,
      fullName: s.beneficiary.fullName,
      category: IN_KIND_CATEGORY_AR[s.category] ?? s.category,
      description: s.description,
      quantity: s.quantity,
      estimatedValue: s.estimatedValue ?? "",
      supportDate: s.supportDate.toISOString().slice(0, 10),
      year: s.year,
    });
  });
  styleHeader(sheet);
  await sendWorkbook(res, workbook, "تقرير_الدعم_العيني.xlsx");
});

// تقرير الدورات التدريبية والمستفيدين منها
reportsRouter.get("/courses.xlsx", async (req, res) => {
  const courses = await prisma.course.findMany({
    include: { enrollments: { include: { beneficiary: true } } },
    orderBy: { startDate: "asc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("الدورات التدريبية");
  sheet.columns = [
    { header: "اسم الدورة", key: "title", width: 24 },
    { header: "الفئة", key: "category", width: 14 },
    { header: "المدرب", key: "trainer", width: 18 },
    { header: "تاريخ البدء", key: "startDate", width: 14 },
    { header: "تاريخ الانتهاء", key: "endDate", width: 14 },
    { header: "عدد المسجلين", key: "enrolled", width: 14 },
    { header: "عدد المكملين", key: "completed", width: 14 },
  ];
  courses.forEach((c) => {
    sheet.addRow({
      title: c.title,
      category: COURSE_CATEGORY_AR[c.category] ?? c.category,
      trainer: c.trainer ?? "",
      startDate: c.startDate.toISOString().slice(0, 10),
      endDate: c.endDate ? c.endDate.toISOString().slice(0, 10) : "",
      enrolled: c.enrollments.length,
      completed: c.enrollments.filter((e) => e.status === "COMPLETED").length,
    });
  });
  styleHeader(sheet);

  const detailSheet = workbook.addWorksheet("تفاصيل المسجلين");
  detailSheet.columns = [
    { header: "اسم الدورة", key: "course", width: 24 },
    { header: "رقم الهوية", key: "nationalId", width: 16 },
    { header: "اسم المستفيد", key: "fullName", width: 26 },
    { header: "الحالة", key: "status", width: 12 },
    { header: "الشهادة", key: "cert", width: 10 },
  ];
  const STATUS_AR: Record<string, string> = { ENROLLED: "مسجل", COMPLETED: "أكمل", DROPPED: "منسحب" };
  courses.forEach((c) => {
    c.enrollments.forEach((e) => {
      detailSheet.addRow({
        course: c.title,
        nationalId: e.beneficiary.nationalId,
        fullName: e.beneficiary.fullName,
        status: STATUS_AR[e.status] ?? e.status,
        cert: e.certificateIssued ? "صدرت" : "لم تصدر",
      });
    });
  });
  styleHeader(detailSheet);

  await sendWorkbook(res, workbook, "تقرير_الدورات_التدريبية.xlsx");
});

// التقرير السنوي الشامل (لمنصة إحسان / المركز الوطني / صندوق دعم الجمعيات)
reportsRouter.get("/annual-summary.xlsx", async (req, res) => {
  const { year } = req.query as Record<string, string>;
  const y = year ? parseInt(year, 10) : new Date().getFullYear();

  const [beneficiaries, cash, inKind, courses] = await Promise.all([
    prisma.beneficiary.findMany(),
    prisma.cashSupport.findMany({ where: { year: y }, include: { beneficiary: true } }),
    prisma.inKindSupport.findMany({ where: { year: y }, include: { beneficiary: true } }),
    prisma.course.findMany({ include: { enrollments: true } }),
  ]);

  const workbook = new ExcelJS.Workbook();

  const summary = workbook.addWorksheet("ملخص عام");
  summary.columns = [
    { header: "البيان", key: "label", width: 30 },
    { header: "القيمة", key: "value", width: 20 },
  ];
  summary.addRows([
    { label: `السنة`, value: y },
    { label: "إجمالي عدد المستفيدين المسجلين", value: beneficiaries.length },
    { label: "إجمالي عدد المستفيدين النشطين", value: beneficiaries.filter((b) => b.fileStatus === "ACTIVE").length },
    { label: "إجمالي عدد عمليات الدعم النقدي خلال السنة", value: cash.length },
    { label: "إجمالي مبالغ الدعم النقدي (ريال)", value: cash.reduce((s, c) => s + c.amount, 0) },
    { label: "إجمالي عدد عمليات الدعم العيني خلال السنة", value: inKind.length },
    {
      label: "إجمالي القيمة التقديرية للدعم العيني (ريال)",
      value: inKind.reduce((s, i) => s + (i.estimatedValue ?? 0), 0),
    },
    { label: "إجمالي عدد الدورات التدريبية", value: courses.length },
    {
      label: "إجمالي عدد المستفيدين المسجلين بالدورات",
      value: courses.reduce((s, c) => s + c.enrollments.length, 0),
    },
    {
      label: "إجمالي عدد المكملين للدورات",
      value: courses.reduce((s, c) => s + c.enrollments.filter((e) => e.status === "COMPLETED").length, 0),
    },
  ]);
  styleHeader(summary);
  summary.getColumn("value").alignment = { horizontal: "center" };

  const cashSheet = workbook.addWorksheet(`الدعم النقدي ${y}`);
  cashSheet.columns = [
    { header: "رقم الهوية", key: "nationalId", width: 16 },
    { header: "اسم المستفيد", key: "fullName", width: 26 },
    { header: "نوع الدعم", key: "type", width: 12 },
    { header: "المبلغ (ريال)", key: "amount", width: 14 },
    { header: "تاريخ الصرف", key: "supportDate", width: 14 },
  ];
  cash.forEach((c) =>
    cashSheet.addRow({
      nationalId: c.beneficiary.nationalId,
      fullName: c.beneficiary.fullName,
      type: CASH_TYPE_AR[c.type] ?? c.type,
      amount: c.amount,
      supportDate: c.supportDate.toISOString().slice(0, 10),
    })
  );
  styleHeader(cashSheet);

  const inKindSheet = workbook.addWorksheet(`الدعم العيني ${y}`);
  inKindSheet.columns = [
    { header: "رقم الهوية", key: "nationalId", width: 16 },
    { header: "اسم المستفيد", key: "fullName", width: 26 },
    { header: "التصنيف", key: "category", width: 16 },
    { header: "الوصف", key: "description", width: 26 },
    { header: "القيمة التقديرية", key: "estimatedValue", width: 16 },
    { header: "التاريخ", key: "supportDate", width: 14 },
  ];
  inKind.forEach((i) =>
    inKindSheet.addRow({
      nationalId: i.beneficiary.nationalId,
      fullName: i.beneficiary.fullName,
      category: IN_KIND_CATEGORY_AR[i.category] ?? i.category,
      description: i.description,
      estimatedValue: i.estimatedValue ?? "",
      supportDate: i.supportDate.toISOString().slice(0, 10),
    })
  );
  styleHeader(inKindSheet);

  await sendWorkbook(res, workbook, `التقرير_السنوي_الشامل_${y}.xlsx`);
});
