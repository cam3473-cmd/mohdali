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
const SUPPORT_CATEGORY_AR: Record<string, string> = {
  IN_KIND: "عيني",
  CASH: "نقدي",
  HOUSING: "سكني",
  ECONOMIC: "اقتصادي",
  HEALTH: "صحي",
  EDUCATIONAL: "تعليمي",
};
const DISBURSEMENT_STATUS_AR: Record<string, string> = {
  PENDING: "معلّق",
  DISBURSED: "مصروف",
  CANCELLED: "ملغى",
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

  const [beneficiariesCount, activeCount, disbursed, byCategory, coursesCount, enrollmentsCount] = await Promise.all([
    prisma.beneficiary.count(),
    prisma.beneficiary.count({ where: { fileStatus: "ACTIVE" } }),
    prisma.support.aggregate({ where: { year: y, status: "DISBURSED" }, _sum: { amount: true }, _count: true }),
    prisma.support.groupBy({
      by: ["category"],
      where: { year: y, status: "DISBURSED" },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.course.count(),
    prisma.courseEnrollment.count(),
  ]);

  res.json({
    year: y,
    beneficiariesCount,
    activeCount,
    supportTotal: disbursed._sum.amount ?? 0,
    supportCount: disbursed._count,
    byCategory: byCategory.map((c) => ({
      category: c.category,
      categoryLabel: SUPPORT_CATEGORY_AR[c.category] ?? c.category,
      total: c._sum.amount ?? 0,
      count: c._count,
    })),
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

// تقرير الدعوم الموحّد (يمكن تصفيته حسب السنة و/أو التصنيف)
reportsRouter.get("/supports.xlsx", async (req, res) => {
  const { year, category } = req.query as Record<string, string>;
  const where: any = {};
  if (year) where.year = parseInt(year, 10);
  if (category) where.category = category;

  const items = await prisma.support.findMany({
    where,
    include: { beneficiary: true },
    orderBy: { supportDate: "asc" },
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("الدعوم");
  sheet.columns = [
    { header: "رقم الهوية", key: "nationalId", width: 16 },
    { header: "اسم المستفيد", key: "fullName", width: 26 },
    { header: "نوع الدعم", key: "category", width: 12 },
    { header: "المبلغ (ريال)", key: "amount", width: 14 },
    { header: "الوصف", key: "description", width: 24 },
    { header: "الكمية", key: "quantity", width: 10 },
    { header: "الحالة", key: "status", width: 12 },
    { header: "تاريخ الصرف", key: "supportDate", width: 14 },
    { header: "السنة", key: "year", width: 8 },
    { header: "ملاحظات", key: "notes", width: 24 },
  ];
  items.forEach((s) => {
    sheet.addRow({
      nationalId: s.beneficiary.nationalId,
      fullName: s.beneficiary.fullName,
      category: SUPPORT_CATEGORY_AR[s.category] ?? s.category,
      amount: s.amount ?? "",
      description: s.description ?? "",
      quantity: s.quantity ?? "",
      status: DISBURSEMENT_STATUS_AR[s.status] ?? s.status,
      supportDate: s.supportDate.toISOString().slice(0, 10),
      year: s.year,
      notes: s.notes ?? "",
    });
  });
  sheet.addRow({});
  // الإجمالي يشمل المبالغ المصروفة فعلياً فقط (يستثني الطلبات المعلّقة أو الملغاة)
  const disbursedTotal = items.filter((s) => s.status === "DISBURSED").reduce((sum, s) => sum + (s.amount ?? 0), 0);
  const totalRow = sheet.addRow({ fullName: "إجمالي المصروف فعلياً (ريال)", amount: disbursedTotal });
  totalRow.font = { bold: true };
  styleHeader(sheet);
  await sendWorkbook(res, workbook, "تقرير_الدعوم.xlsx");
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

  const [beneficiaries, supports, courses] = await Promise.all([
    prisma.beneficiary.findMany(),
    // يقتصر التقرير الرسمي على الدعم المصروف فعلياً، مع استبعاد الطلبات المعلّقة أو الملغاة
    prisma.support.findMany({ where: { year: y, status: "DISBURSED" }, include: { beneficiary: true } }),
    prisma.course.findMany({ include: { enrollments: true } }),
  ]);

  const workbook = new ExcelJS.Workbook();

  const categoryTotals = new Map<string, { count: number; total: number }>();
  for (const s of supports) {
    const entry = categoryTotals.get(s.category) ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += s.amount ?? 0;
    categoryTotals.set(s.category, entry);
  }

  const summary = workbook.addWorksheet("ملخص عام");
  summary.columns = [
    { header: "البيان", key: "label", width: 34 },
    { header: "القيمة", key: "value", width: 20 },
  ];
  const summaryRows: { label: string; value: number | string }[] = [
    { label: "السنة", value: y },
    { label: "إجمالي عدد المستفيدين المسجلين", value: beneficiaries.length },
    { label: "إجمالي عدد المستفيدين النشطين", value: beneficiaries.filter((b) => b.fileStatus === "ACTIVE").length },
    { label: "إجمالي عدد عمليات الدعم المصروفة خلال السنة", value: supports.length },
    { label: "إجمالي قيمة الدعم المصروف (ريال)", value: supports.reduce((s, c) => s + (c.amount ?? 0), 0) },
  ];
  for (const [category, { count, total }] of categoryTotals) {
    const label = SUPPORT_CATEGORY_AR[category] ?? category;
    summaryRows.push({ label: `عدد عمليات الدعم ${label}`, value: count });
    summaryRows.push({ label: `قيمة الدعم ${label} (ريال)`, value: total });
  }
  summaryRows.push(
    { label: "إجمالي عدد الدورات التدريبية", value: courses.length },
    { label: "إجمالي عدد المستفيدين المسجلين بالدورات", value: courses.reduce((s, c) => s + c.enrollments.length, 0) },
    {
      label: "إجمالي عدد المكملين للدورات",
      value: courses.reduce((s, c) => s + c.enrollments.filter((e) => e.status === "COMPLETED").length, 0),
    }
  );
  summary.addRows(summaryRows);
  styleHeader(summary);
  summary.getColumn("value").alignment = { horizontal: "center" };

  const supportSheet = workbook.addWorksheet(`الدعوم ${y}`);
  supportSheet.columns = [
    { header: "رقم الهوية", key: "nationalId", width: 16 },
    { header: "اسم المستفيد", key: "fullName", width: 26 },
    { header: "نوع الدعم", key: "category", width: 12 },
    { header: "المبلغ (ريال)", key: "amount", width: 14 },
    { header: "الوصف", key: "description", width: 24 },
    { header: "تاريخ الصرف", key: "supportDate", width: 14 },
  ];
  supports.forEach((s) =>
    supportSheet.addRow({
      nationalId: s.beneficiary.nationalId,
      fullName: s.beneficiary.fullName,
      category: SUPPORT_CATEGORY_AR[s.category] ?? s.category,
      amount: s.amount ?? "",
      description: s.description ?? "",
      supportDate: s.supportDate.toISOString().slice(0, 10),
    })
  );
  styleHeader(supportSheet);

  await sendWorkbook(res, workbook, `التقرير_السنوي_الشامل_${y}.xlsx`);
});
