import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { buildSurveyLink, sendSms, SmsConfigError, SmsSendError } from "../lib/sms";

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

const sendSurveySchema = z.object({ supportIds: z.array(z.string().min(1)).min(1) });

// إرسال رسالة نصية فيها رابط استبيان قياس الرضا لكل سجل دعم في القائمة، برقم جوال
// المستفيد المسجَّل. يُتخطى أي سجل بلا رقم جوال أو مستفيد بلا رقم، ويُعاد تفصيل
// النتيجة لكل سجل (نجاح/تخطي/فشل) حتى يعرف الموظف من أُرسل له فعلاً.
supportsRouter.post("/send-survey", async (req, res) => {
  const parsed = sendSurveySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }

  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (!settings?.surveyFormBaseUrl) {
    return res.status(400).json({ error: "لم يتم ضبط رابط استبيان قياس الرضا بعد — راجع شاشة الإعدادات" });
  }

  const supports = await prisma.support.findMany({
    where: { id: { in: parsed.data.supportIds } },
    include: { beneficiary: true },
  });

  const results: { supportId: string; status: "sent" | "skipped" | "failed"; reason?: string }[] = [];
  for (const support of supports) {
    if (!support.beneficiary.phone) {
      results.push({ supportId: support.id, status: "skipped", reason: "لا يوجد رقم جوال مسجَّل لهذا المستفيد" });
      continue;
    }
    try {
      const link = buildSurveyLink(settings.surveyFormBaseUrl, settings.surveyFormEntryParam, support.beneficiary.id);
      const message = `شكراً لتواصلكم مع جمعية البر الخيرية بمحافظة السليل، نرجو تقييم تجربتكم: ${link}`;
      await sendSms(support.beneficiary.phone, message);
      await prisma.support.update({ where: { id: support.id }, data: { surveySentAt: new Date() } });
      results.push({ supportId: support.id, status: "sent" });
    } catch (err) {
      const reason = err instanceof SmsConfigError || err instanceof SmsSendError ? err.message : "خطأ غير متوقع";
      results.push({ supportId: support.id, status: "failed", reason });
    }
  }

  res.json({ results });
});
