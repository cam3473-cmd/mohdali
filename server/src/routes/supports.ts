import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { buildSurveyLink } from "../lib/survey";

export const supportsRouter = Router();
supportsRouter.use(requireAuth);

// تصنيفات الدعم الموحّدة (يشملها جميعاً المجال الاجتماعي للجمعية)
export const SUPPORT_CATEGORIES = ["IN_KIND", "CASH", "HOUSING", "ECONOMIC", "HEALTH", "EDUCATIONAL", "SERVICES"] as const;

const schema = z.object({
  beneficiaryId: z.string().min(1),
  category: z.enum(SUPPORT_CATEGORIES),
  amount: z.number().nonnegative().optional().nullable(),
  description: z.string().optional().nullable(),
  quantity: z.number().int().positive().optional().nullable(),
  supportDate: z.string().datetime(),
  year: z.number().int(),
  status: z.enum(["PENDING", "DISBURSED", "CANCELLED"]).optional(),
  notes: z.string().optional().nullable(),
});

supportsRouter.get("/", async (req, res) => {
  const { beneficiaryId, year, category, status } = req.query as Record<string, string>;
  const where: any = {};
  if (beneficiaryId) where.beneficiaryId = beneficiaryId;
  if (year) where.year = parseInt(year, 10);
  if (category) where.category = category;
  if (status) where.status = status;

  const items = await prisma.support.findMany({
    where,
    include: { beneficiary: { select: { fullName: true, nationalId: true } } },
    orderBy: { supportDate: "desc" },
  });
  res.json(items);
});

// تفاصيل سجل دعم واحد (تُستخدم لعرض سند الصرف القابل للطباعة)
supportsRouter.get("/:id", async (req, res) => {
  const item = await prisma.support.findUnique({
    where: { id: req.params.id },
    include: { beneficiary: true, batch: true },
  });
  if (!item) return res.status(404).json({ error: "السجل غير موجود" });
  res.json(item);
});

supportsRouter.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const created = await prisma.support.create({
    data: {
      ...data,
      supportDate: new Date(data.supportDate),
      createdById: req.user!.userId,
    },
  });
  res.status(201).json(created);
});

supportsRouter.put("/:id", async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const updated = await prisma.support.update({
      where: { id: req.params.id },
      data: {
        ...data,
        supportDate: data.supportDate ? new Date(data.supportDate) : undefined,
      },
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "السجل غير موجود" });
  }
});

supportsRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.support.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "السجل غير موجود" });
  }
});

// يُرسل الموظف رسائل الاستبيان يدوياً عبر بوابة منصة الرسائل النصية (حساب مشترك بين عدة
// جهات، لا يوفّر النظام مفتاح API خاصاً بالجمعية). لذا يكتفي الخادم هنا بإرجاع رابط
// الاستبيان الشخصي لسجل الدعم مباشرة، ليَنسخه الموظف ويُلصقه في المنصة بنفسه.
supportsRouter.get("/:id/survey-link", async (req, res) => {
  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (!settings?.surveyFormBaseUrl) {
    return res.status(400).json({ error: "لم يتم ضبط رابط استبيان قياس الرضا بعد — راجع شاشة الإعدادات" });
  }
  const support = await prisma.support.findUnique({
    where: { id: req.params.id },
    include: { beneficiary: true },
  });
  if (!support) return res.status(404).json({ error: "السجل غير موجود" });

  const link = buildSurveyLink(settings.surveyFormBaseUrl, settings.surveyFormEntryParam, support.beneficiary.id);
  res.json({ link, phone: support.beneficiary.phone });
});

const markSurveySentSchema = z.object({ supportIds: z.array(z.string().min(1)).min(1), sent: z.boolean() });

// تمييز سجل دعم كـ "أُرسل له الاستبيان" (أو التراجع عن ذلك) — يدوي بالكامل، بعد أن يرسل
// الموظف الرسالة فعلياً من بوابة منصة الرسائل، حتى يُعرف من تم تذكيره ومن لا
supportsRouter.post("/mark-survey-sent", async (req, res) => {
  const parsed = markSurveySentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  await prisma.support.updateMany({
    where: { id: { in: parsed.data.supportIds } },
    data: { surveySentAt: parsed.data.sent ? new Date() : null },
  });
  res.json({ ok: true });
});
