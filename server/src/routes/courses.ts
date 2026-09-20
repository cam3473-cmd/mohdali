import { Router } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const coursesRouter = Router();
coursesRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const courseSchema = z.object({
  title: z.string().min(1),
  category: z.enum(["COMPUTER", "LANGUAGES", "AI", "LIFE_SKILLS", "OTHER"]),
  trainer: z.string().optional().nullable(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional().nullable(),
  seatsCount: z.number().int().positive().optional().nullable(),
  location: z.string().optional().nullable(),
  totalCost: z.number().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// مشارك الدورة: سجلّ مستقل تماماً عن جدول المستفيدين (بيانات مباشرة)،
// مع ربط اختياري ببنفيديري مسجَّل لأغراض الإحالة فقط
const participantSchema = z.object({
  fullName: z.string().min(1),
  civilId: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  birthDate: z.string().datetime().optional().nullable(),
  birthDateHijri: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  beneficiaryId: z.string().optional().nullable(),
  status: z.enum(["ENROLLED", "COMPLETED", "DROPPED"]).optional(),
  certificateIssued: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

coursesRouter.get("/", async (req, res) => {
  const { category } = req.query as Record<string, string>;
  const where: any = {};
  if (category) where.category = category;

  const items = await prisma.course.findMany({
    where,
    include: { _count: { select: { participants: true } } },
    orderBy: { startDate: "desc" },
  });
  res.json(items);
});

coursesRouter.get("/:id", async (req, res) => {
  const item = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: { participants: { include: { beneficiary: true }, orderBy: { createdAt: "desc" } } },
  });
  if (!item) return res.status(404).json({ error: "الدورة غير موجودة" });
  res.json(item);
});

coursesRouter.post("/", async (req, res) => {
  const parsed = courseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const created = await prisma.course.create({
    data: {
      ...data,
      startDate: new Date(data.startDate),
      endDate: data.endDate ? new Date(data.endDate) : null,
      createdById: req.user!.userId,
    },
  });
  res.status(201).json(created);
});

coursesRouter.put("/:id", async (req, res) => {
  const parsed = courseSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const updated = await prisma.course.update({
      where: { id: req.params.id },
      data: {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "الدورة غير موجودة" });
  }
});

coursesRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.course.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "الدورة غير موجودة" });
  }
});

// إضافة مشارك مباشرة (لا يتطلب وجوده في جدول المستفيدين)
coursesRouter.post("/:id/participants", async (req, res) => {
  const parsed = participantSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const created = await prisma.courseParticipant.create({
      data: {
        ...data,
        birthDate: data.birthDate ? new Date(data.birthDate) : null,
        courseId: req.params.id,
        createdById: req.user!.userId,
      },
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "P2003") {
      return res.status(400).json({ error: "الدورة أو المستفيد المرتبط غير موجود" });
    }
    res.status(400).json({ error: "تعذر إضافة المشارك" });
  }
});

coursesRouter.put("/participants/:participantId", async (req, res) => {
  const parsed = participantSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const updated = await prisma.courseParticipant.update({
      where: { id: req.params.participantId },
      data: {
        ...data,
        birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
      },
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "السجل غير موجود" });
  }
});

coursesRouter.delete("/participants/:participantId", async (req, res) => {
  try {
    await prisma.courseParticipant.delete({ where: { id: req.params.participantId } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "السجل غير موجود" });
  }
});

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

// استيراد مشاركين لدورة من ملف إكسل دفعة واحدة، بدل إدخالهم واحداً تلو الآخر
coursesRouter.post("/:id/participants/import", upload.single("file"), async (req, res) => {
  const course = await prisma.course.findUnique({ where: { id: req.params.id } });
  if (!course) return res.status(404).json({ error: "الدورة غير موجودة" });

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

  const FULL_NAME_HEADERS = ["الاسم", "اسم المشارك"];
  if (!FULL_NAME_HEADERS.some((h) => colIndex[h])) {
    return res.status(400).json({ error: "عمود مطلوب مفقود في الملف: الاسم" });
  }

  const results = { insertedCount: 0, errors: [] as { row: number; message: string }[] };
  const toCreate: any[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const fullName = getCellText(row, colIndex, FULL_NAME_HEADERS);
    if (!fullName) return;

    toCreate.push({
      fullName,
      civilId: getCellText(row, colIndex, ["السجل المدني", "الهوية", "السجل المدني / الهوية"]) || null,
      phone: getCellText(row, colIndex, ["الجوال", "رقم الجوال"]) || null,
      birthDate: getCellDate(row, colIndex, ["تاريخ الميلاد", "تاريخ الميلاد الميلادي"]),
      birthDateHijri: getCellText(row, colIndex, ["تاريخ الميلاد الهجري"]) || null,
      email: getCellText(row, colIndex, ["البريد الإلكتروني", "الإيميل"]) || null,
      courseId: course.id,
      createdById: req.user!.userId,
    });
  });

  if (toCreate.length > 0) {
    await prisma.courseParticipant.createMany({ data: toCreate });
    results.insertedCount = toCreate.length;
  }

  res.json(results);
});
