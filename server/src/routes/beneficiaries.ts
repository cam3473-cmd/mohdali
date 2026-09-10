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
  nationalId: z.string().min(1),
  fullName: z.string().min(1),
  gender: z.enum(["MALE", "FEMALE"]),
  birthDate: z.string().datetime().optional().nullable(),
  maritalStatus: z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"]).optional().nullable(),
  familyMembersCount: z.number().int().nonnegative().optional().nullable(),
  monthlyIncome: z.number().nonnegative().optional().nullable(),
  neighborhood: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
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
const FILE_STATUS_FROM_AR: Record<string, string> = { "نشط": "ACTIVE", "موقوف": "SUSPENDED", "مغلق": "CLOSED" };

function normalizeCode(value: string, arMap: Record<string, string>, validCodes: string[]): string | null {
  const t = value.trim();
  if (arMap[t]) return arMap[t];
  const upper = t.toUpperCase();
  if (validCodes.includes(upper)) return upper;
  return null;
}

// استيراد مستفيدين من ملف إكسل بنفس أعمدة تقرير "المستفيدين" المُصدَّر من النظام
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

  const requiredHeaders = ["رقم الهوية", "الاسم", "الجنس"];
  const missingHeaders = requiredHeaders.filter((h) => !colIndex[h]);
  if (missingHeaders.length > 0) {
    return res.status(400).json({
      error: `أعمدة مطلوبة مفقودة في الملف: ${missingHeaders.join("، ")}. استخدم نفس تنسيق تقرير "المستفيدين" المُصدَّر من النظام.`,
    });
  }

  const cellText = (row: ExcelJS.Row, header: string): string => {
    const idx = colIndex[header];
    if (!idx) return "";
    const v = row.getCell(idx).value;
    if (v === null || v === undefined) return "";
    if (typeof v === "object" && v !== null && "text" in (v as any)) return String((v as any).text ?? "").trim();
    return String(v).trim();
  };

  const results = {
    insertedCount: 0,
    skippedDuplicates: [] as { row: number; nationalId: string }[],
    errors: [] as { row: number; message: string }[],
  };

  const existingIds = new Set(
    (await prisma.beneficiary.findMany({ select: { nationalId: true } })).map((b) => b.nationalId)
  );
  const toCreate: any[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const nationalId = cellText(row, "رقم الهوية");
    const fullName = cellText(row, "الاسم");
    if (!nationalId && !fullName) return;

    if (!nationalId || !fullName) {
      results.errors.push({ row: rowNumber, message: "رقم الهوية والاسم حقلان مطلوبان" });
      return;
    }
    if (existingIds.has(nationalId)) {
      results.skippedDuplicates.push({ row: rowNumber, nationalId });
      return;
    }

    const genderRaw = cellText(row, "الجنس");
    const gender = normalizeCode(genderRaw, GENDER_FROM_AR, ["MALE", "FEMALE"]);
    if (!gender) {
      results.errors.push({ row: rowNumber, message: `قيمة الجنس غير صحيحة: "${genderRaw}" (المتوقع: ذكر / أنثى)` });
      return;
    }

    const maritalRaw = cellText(row, "الحالة الاجتماعية");
    const maritalStatus = maritalRaw ? normalizeCode(maritalRaw, MARITAL_FROM_AR, ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"]) : null;
    if (maritalRaw && !maritalStatus) {
      results.errors.push({ row: rowNumber, message: `قيمة الحالة الاجتماعية غير معروفة: "${maritalRaw}"` });
      return;
    }

    const fileStatusRaw = cellText(row, "حالة الملف");
    const fileStatus = fileStatusRaw ? normalizeCode(fileStatusRaw, FILE_STATUS_FROM_AR, ["ACTIVE", "SUSPENDED", "CLOSED"]) : "ACTIVE";
    if (fileStatusRaw && !fileStatus) {
      results.errors.push({ row: rowNumber, message: `قيمة حالة الملف غير معروفة: "${fileStatusRaw}"` });
      return;
    }

    const familyRaw = cellText(row, "عدد أفراد الأسرة");
    const familyMembersCount = familyRaw ? parseInt(familyRaw, 10) : null;
    if (familyRaw && Number.isNaN(familyMembersCount)) {
      results.errors.push({ row: rowNumber, message: "عدد أفراد الأسرة يجب أن يكون رقماً" });
      return;
    }

    const incomeRaw = cellText(row, "الدخل الشهري");
    const monthlyIncome = incomeRaw ? parseFloat(incomeRaw) : null;
    if (incomeRaw && Number.isNaN(monthlyIncome)) {
      results.errors.push({ row: rowNumber, message: "الدخل الشهري يجب أن يكون رقماً" });
      return;
    }

    existingIds.add(nationalId);
    toCreate.push({
      nationalId,
      fullName,
      gender,
      maritalStatus,
      familyMembersCount,
      monthlyIncome,
      neighborhood: cellText(row, "الحي") || null,
      phone: cellText(row, "الجوال") || null,
      needCategory: cellText(row, "تصنيف الاحتياج") || null,
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
  const take = Math.min(parseInt(pageSize, 10) || 50, 200);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

  const where: any = {};
  if (status) where.fileStatus = status;
  if (q) {
    where.OR = [
      { fullName: { contains: q } },
      { nationalId: { contains: q } },
      { phone: { contains: q } },
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

  const created = await prisma.beneficiary.create({
    data: {
      ...data,
      birthDate: data.birthDate ? new Date(data.birthDate) : null,
      createdById: req.user!.userId,
    },
  });
  res.status(201).json(created);
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
