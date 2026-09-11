import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { SUPPORT_CATEGORIES } from "./supports";

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

// تُستخدم لتوليد اسم افتراضي للدفعة عند عدم إدخال اسم مخصص
const SUPPORT_CATEGORY_AR: Record<string, string> = {
  IN_KIND: "عيني",
  CASH: "نقدي",
  HOUSING: "سكني",
  ECONOMIC: "اقتصادي",
  HEALTH: "صحي",
  EDUCATIONAL: "تعليمي",
};

const campaignSchema = z.object({
  title: z.string().min(1).optional().nullable(),
  category: z.enum(SUPPORT_CATEGORIES),
  perPersonRate: z.number().nonnegative().optional().nullable(),
  totalBudget: z.number().nonnegative().optional().nullable(),
  distributionDate: z.string().datetime(),
  year: z.number().int(),
  notes: z.string().optional().nullable(),
});

// عنصر توزيع واحد لمستفيد ضمن الحملة (يُحسب في الواجهة ويمكن تعديله قبل التأكيد)
const distributeItemSchema = z.object({
  beneficiaryId: z.string().min(1),
  amount: z.number().nonnegative().optional().nullable(),
  description: z.string().optional().nullable(),
  quantity: z.number().int().positive().optional().nullable(),
});

const distributeSchema = z.object({
  items: z.array(distributeItemSchema).min(1),
});

campaignsRouter.get("/", async (_req, res) => {
  const items = await prisma.supportCampaign.findMany({
    include: { _count: { select: { supports: true } } },
    orderBy: { distributionDate: "desc" },
  });
  res.json(items);
});

campaignsRouter.get("/:id", async (req, res) => {
  const item = await prisma.supportCampaign.findUnique({
    where: { id: req.params.id },
    include: { supports: { include: { beneficiary: true } } },
  });
  if (!item) return res.status(404).json({ error: "الحملة غير موجودة" });
  res.json(item);
});

campaignsRouter.post("/", async (req, res) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const distributionDate = new Date(data.distributionDate);
  const defaultTitle = `دعم ${SUPPORT_CATEGORY_AR[data.category] ?? data.category} - ${distributionDate.toLocaleDateString("ar-SA")}`;
  const created = await prisma.supportCampaign.create({
    data: {
      ...data,
      title: data.title?.trim() || defaultTitle,
      distributionDate,
      createdById: req.user!.userId,
    },
  });
  res.status(201).json(created);
});

campaignsRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.supportCampaign.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "الحملة غير موجودة" });
  }
});

// تنفيذ التوزيع: إنشاء سجل دعم واحد لكل مستفيد مُختار بالقيمة المؤكَّدة من الواجهة
campaignsRouter.post("/:id/distribute", async (req, res) => {
  const parsed = distributeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }

  const campaign = await prisma.supportCampaign.findUnique({ where: { id: req.params.id } });
  if (!campaign) return res.status(404).json({ error: "الحملة غير موجودة" });

  const { items } = parsed.data;
  const created = await prisma.$transaction(
    items.map((item) =>
      prisma.support.create({
        data: {
          beneficiaryId: item.beneficiaryId,
          category: campaign.category,
          amount: item.amount ?? null,
          description: item.description ?? null,
          quantity: item.quantity ?? null,
          supportDate: campaign.distributionDate,
          year: campaign.year,
          status: "DISBURSED",
          campaignId: campaign.id,
          createdById: req.user!.userId,
        },
      })
    )
  );

  res.status(201).json({ createdCount: created.length, items: created });
});
