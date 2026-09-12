import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const beneficiariesRouter = Router();
beneficiariesRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const beneficiarySchema = z.object({
  fileNumber: z.string().optional().nullable(),
  nationalId: z.string().min(1),
  fullName: z.string().min(1),
  gender: z.enum(["MALE", "FEMALE"]),
  birthDate: z.string().datetime().optional().nullable(),
  birthDateHijri: z.string().optional().nullable(),
  maritalStatus: z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"]).optional().nullable(),
  caseType: z.enum(["INDIVIDUAL", "FAMILY"]).optional().nullable(),
  familyMembersCount: z.number().int().nonnegative().optional().nullable(),
  monthlyIncome: z.number().nonnegative().optional().nullable(),
  neighborhood: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  iban: z.string().optional().nullable(),
  needCategory: z.string().optional().nullable(),
  fileStatus: z.enum(["ACTIVE", "SUSPENDED", "CLOSED"]).optional(),
  notes: z.string().optional().nullable(),
});

const GENDER_FROM_AR: Record<string, string> = { "ذكر": "MALE", "أنثى": "FEMALE" };
const MARITAL_FROM_AR: Record<string, string> = {
  "أعزب": "SINGLE",
  "متزوج": "MARRIED",
  "مطلق": "DIVORCED",
  "أرمل": "WIDOWED",
};
const CASE_TYPE_FROM_AR: Record<string, string> = { "فرد": "INDIVIDUAL", "أسرة": "FAMILY" };

function normalizeCode(value: string, arMap: Record<string, string>, validCodes: string[]): string | null {
  const t = value.trim();
  if (arMap[t]) return arMap[t];
  const upper = t.toUpperCase();
  if (validCodes.includes(upper)) return upper;
  return null;
}

// "الحالة" في ملفات الجمعية الفعلية تأتي بصيغة مثل "فعال 2026"، لذا نتحقق بالاحتواء لا بالمطابقة التامة
function normalizeFileStatusFuzzy(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/فعال|نشط/.test(t)) return "ACTIVE";
  if (/موقوف/.test(t)) return "SUSPENDED";
  if (/مغلق/.test(t)) return "CLOSED";
  const upper = t.toUpperCase();
  if (["ACTIVE", "SUSPENDED", "CLOSED"].includes(upper)) return upper;
  return null;
}

function getCellRaw(row: ExcelJS.Row, colIndex: Record<string, number>, candidates: string[]): ExcelJS.CellValue {
  for (const c of candidates) {
    const idx = colIndex[c];
    if (idx) return row.getCell(idx).value;
  }
  return null;
}

function textFromRaw(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && v !== null && "text" in (v as any)) return String((v as any).text ?? "").trim();
  return String(v).trim();
}

function getCellText(row: ExcelJS.Row, colIndex: Record<string, number>, candidates: string[]): string {
  return textFromRaw(getCellRaw(row, colIndex, candidates));
}

function getCellDate(row: ExcelJS.Row, colIndex: Record<string, number>, candidates: string[]): Date | null {
  const raw = getCellRaw(row, colIndex, candidates);
  if (raw instanceof Date) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw.trim());
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

// استيراد مستفيدين من ملف إكسل — يقبل عناوين أعمدة تقرير "المستفيدين" المُصدَّر من النظام،
// وكذلك عناوين الأعمدة الشائعة في ملفات بيانات الجمعية الحالية (أسماء بديلة لكل حقل)
beneficiariesRouter.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "الرجاء إرفاق ملف إكسل" });
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer as any);
  } catch {
    return res.status(400).json({ error: "تعذرت قراءة الملف، تأكد أنه ملف Excel صالح (xlsx)" });
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return res.status(400).json({ error: "الملف لا يحتوي أي ورقة بيانات" });
  }

  const colIndex: Record<string, number> = {};
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const text = String(cell.value ?? "").trim();
    if (text) colIndex[text] = colNumber;
  });

  const NATIONAL_ID_HEADERS = ["رقم الهوية"];
  const FULL_NAME_HEADERS = ["الاسم", "اسم المستفيد"];
  const GENDER_HEADERS = ["الجنس"];

  const missingHeaders: string[] = [];
  if (!NATIONAL_ID_HEADERS.some((h) => colIndex[h])) missingHeaders.push("رقم الهوية");
  if (!FULL_NAME_HEADERS.some((h) => colIndex[h])) missingHeaders.push("الاسم");
  if (!GENDER_HEADERS.some((h) => colIndex[h])) missingHeaders.push("الجنس");
  if (missingHeaders.length > 0) {
    return res.status(400).json({
      error: `أعمدة مطلوبة مفقودة في الملف: ${missingHeaders.join("، ")}.`,
    });
  }

  const results = {
    insertedCount: 0,
    skippedDuplicates: [] as { row: number; nationalId: string }[],
    errors: [] as { row: number; message: string }[],
  };

  const existingBeneficiaries = await prisma.beneficiary.findMany({
    select: { nationalId: true, fileNumber: true },
  });
  const existingIds = new Set(existingBeneficiaries.map((b) => b.nationalId));
  const existingFileNumbers = new Set(existingBeneficiaries.map((b) => b.fileNumber).filter((v): v is string => !!v));
  const toCreate: any[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const nationalId = getCellText(row, colIndex, NATIONAL_ID_HEADERS);
    const fullName = getCellText(row, colIndex, FULL_NAME_HEADERS);
    if (!nationalId && !fullName) return;

    if (!nationalId || !fullName) {
      results.errors.push({ row: rowNumber, message: "رقم الهوية والاسم حقلان مطلوبان" });
      return;
    }
    if (existingIds.has(nationalId)) {
      results.skippedDuplicates.push({ row: rowNumber, nationalId });
      return;
    }

    const genderRaw = getCellText(row, colIndex, GENDER_HEADERS);
    const gender = normalizeCode(genderRaw, GENDER_FROM_AR, ["MALE", "FEMALE"]);
    if (!gender) {
      results.errors.push({ row: rowNumber, message: `قيمة الجنس غير صحيحة: "${genderRaw}" (المتوقع: ذكر / أنثى)` });
      return;
    }

    // عمود "الحالة الاجتماعية" في بعض ملفات الجمعية يحمل قيم "فرد/أسرة" (نوع الملف) بدل الحالة
    // الاجتماعية الفعلية؛ نميّز تلقائياً حسب القيمة، مع دعم عمود "نوع الملف" المنفصل أيضاً إن وُجد.
    let maritalStatus: string | null = null;
    let caseType: string | null = null;

    const caseTypeDirectRaw = getCellText(row, colIndex, ["نوع الملف"]);
    if (caseTypeDirectRaw) {
      caseType = normalizeCode(caseTypeDirectRaw, CASE_TYPE_FROM_AR, ["INDIVIDUAL", "FAMILY"]);
      if (!caseType) {
        results.errors.push({ row: rowNumber, message: `قيمة نوع الملف غير معروفة: "${caseTypeDirectRaw}" (المتوقع: فرد / أسرة)` });
        return;
      }
    }

    const maritalRaw = getCellText(row, colIndex, ["الحالة الاجتماعية"]);
    if (maritalRaw) {
      const asCaseType = normalizeCode(maritalRaw, CASE_TYPE_FROM_AR, ["INDIVIDUAL", "FAMILY"]);
      if (asCaseType) {
        if (!caseType) caseType = asCaseType;
      } else {
        const asMarital = normalizeCode(maritalRaw, MARITAL_FROM_AR, ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"]);
        if (!asMarital) {
          results.errors.push({ row: rowNumber, message: `قيمة الحالة الاجتماعية غير معروفة: "${maritalRaw}"` });
          return;
        }
        maritalStatus = asMarital;
      }
    }

    const fileStatusRaw = getCellText(row, colIndex, ["حالة الملف", "الحالة"]);
    const fileStatus = fileStatusRaw ? normalizeFileStatusFuzzy(fileStatusRaw) : "ACTIVE";
    if (fileStatusRaw && !fileStatus) {
      results.errors.push({ row: rowNumber, message: `قيمة حالة الملف غير معروفة: "${fileStatusRaw}"` });
      return;
    }

    const familyRaw = getCellText(row, colIndex, ["عدد أفراد الأسرة", "عدد الافراد", "عدد الأفراد"]);
    const familyMembersCount = familyRaw ? parseInt(familyRaw, 10) : null;
    if (familyRaw && Number.isNaN(familyMembersCount)) {
      results.errors.push({ row: rowNumber, message: "عدد أفراد الأسرة يجب أن يكون رقماً" });
      return;
    }

    const incomeRaw = getCellText(row, colIndex, ["الدخل الشهري", "الدخل"]);
    const monthlyIncome = incomeRaw ? parseFloat(incomeRaw) : null;
    if (incomeRaw && Number.isNaN(monthlyIncome)) {
      results.errors.push({ row: rowNumber, message: "الدخل الشهري يجب أن يكون رقماً" });
      return;
    }

    const fileNumber = getCellText(row, colIndex, ["رقم الملف"]) || null;
    if (fileNumber && existingFileNumbers.has(fileNumber)) {
      results.errors.push({ row: rowNumber, message: `رقم الملف "${fileNumber}" مستخدم مسبقاً لمستفيد آخر` });
      return;
    }

    const birthDate = getCellDate(row, colIndex, ["تاريخ الميلاد", "تاريخ الميلاد ميلادي"]);

    existingIds.add(nationalId);
    if (fileNumber) existingFileNumbers.add(fileNumber);
    toCreate.push({
      fileNumber,
      nationalId,
      fullName,
      gender,
      birthDate,
      birthDateHijri: getCellText(row, colIndex, ["تاريخ الميلاد الهجري"]) || null,
      maritalStatus,
      caseType,
      familyMembersCount,
      monthlyIncome,
      neighborhood: getCellText(row, colIndex, ["الحي"]) || null,
      phone: getCellText(row, colIndex, ["الجوال", "رقم الجوال"]) || null,
      iban: getCellText(row, colIndex, ["الآيبان", "الايبان", "IBAN"]) || null,
      needCategory: getCellText(row, colIndex, ["تصنيف الاحتياج"]) || null,
      fileStatus: fileStatus ?? "ACTIVE",
      createdById: req.user!.userId,
    });
  });

  if (toCreate.length > 0) {
    await prisma.beneficiary.createMany({ data: toCreate });
    results.insertedCount = toCreate.length;
  }

  res.json(results);
});

// قائمة المستفيدين مع بحث وتصفية
beneficiariesRouter.get("/", async (req, res) => {
  const { q, status, page = "1", pageSize = "50" } = req.query as Record<string, string>;
  const take = Math.min(parseInt(pageSize, 10) || 50, 5000);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const where: any = {};
  if (status) where.fileStatus = status;
  if (q) {
    where.OR = [
      { fullName: { contains: q } },
      { nationalId: { contains: q } },
      { phone: { contains: q } },
      { fileNumber: { contains: q } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.beneficiary.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
    }),
    prisma.beneficiary.count({ where }),
  ]);

  res.json({ items, total, page: Number(page), pageSize: take });
});

beneficiariesRouter.get("/:id", async (req, res) => {
  const item = await prisma.beneficiary.findUnique({
    where: { id: req.params.id },
    include: {
      supports: { orderBy: { supportDate: "desc" } },
      enrollments: { include: { course: true } },
    },
  });
  if (!item) return res.status(404).json({ error: "المستفيد غير موجود" });
  res.json(item);
});

beneficiariesRouter.post("/", async (req, res) => {
  const parsed = beneficiarySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;

  const existing = await prisma.beneficiary.findUnique({ where: { nationalId: data.nationalId } });
  if (existing) {
    return res.status(409).json({ error: "رقم الهوية مسجل مسبقاً" });
  }

  try {
    const created = await prisma.beneficiary.create({
      data: {
        ...data,
        birthDate: data.birthDate ? new Date(data.birthDate) : null,
        createdById: req.user!.userId,
      },
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "رقم الملف مستخدم مسبقاً لمستفيد آخر" });
    }
    throw err;
  }
});

beneficiariesRouter.put("/:id", async (req, res) => {
  const parsed = beneficiarySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;

  try {
    const updated = await prisma.beneficiary.update({
      where: { id: req.params.id },
      data: {
        ...data,
        birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
      },
    });
    res.json(updated);
  } catch (err: any) {
    if (err?.code === "P2002") {
      const target = String(err?.meta?.target ?? "");
      if (target.includes("fileNumber")) {
        return res.status(409).json({ error: "رقم الملف مستخدم مسبقاً لمستفيد آخر" });
      }
      return res.status(409).json({ error: "رقم الهوية مسجل مسبقاً لمستفيد آخر" });
    }
    res.status(404).json({ error: "المستفيد غير موجود" });
  }
});

beneficiariesRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.beneficiary.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "المستفيد غير موجود" });
  }
});
