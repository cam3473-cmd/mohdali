import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { SUPPORT_CATEGORIES } from "./supports";

export const batchesRouter = Router();
batchesRouter.use(requireAuth);

// تُستخدم لتوليد اسم افتراضي للدفعة عند عدم إدخال اسم مخصص
const SUPPORT_CATEGORY_AR: Record<string, string> = {
  IN_KIND: "عيني",
  CASH: "نقدي",
  HOUSING: "سكني",
  ECONOMIC: "اقتصادي",
  HEALTH: "صحي",
  EDUCATIONAL: "تعليمي",
  SERVICES: "خدمات",
};

const DISTRIBUTION_METHODS = ["UNIFIED", "HEAD_PLUS_DEPENDENTS"] as const;

const batchSchema = z.object({
  title: z.string().min(1).optional().nullable(),
  category: z.enum(SUPPORT_CATEGORIES),
  // إما مبلغ إجمالي مباشر، أو كمية × سعر وحدة (للعيني) يُحسب منهما الإجمالي
  totalAmount: z.number().nonnegative().optional().nullable(),
  quantity: z.number().int().positive().optional().nullable(),
  unitPrice: z.number().nonnegative().optional().nullable(),
  receivedDate: z.string().datetime(),
  year: z.number().int(),
  distributionMethod: z.enum(DISTRIBUTION_METHODS),
  unifiedAmount: z.number().nonnegative().optional().nullable(),
  headAmount: z.number().nonnegative().optional().nullable(),
  dependentAmount: z.number().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const distributeItemSchema = z.object({
  beneficiaryId: z.string().min(1),
  amount: z.number().nonnegative().optional().nullable(),
  description: z.string().optional().nullable(),
  quantity: z.number().int().positive().optional().nullable(),
});

const distributeSchema = z.object({
  items: z.array(distributeItemSchema).min(1),
});

function computeTotal(data: z.infer<typeof batchSchema>) {
  if (data.quantity != null && data.unitPrice != null) {
    return Math.round(data.quantity * data.unitPrice * 100) / 100;
  }
  return data.totalAmount ?? 0;
}

async function withRemaining(batch: any) {
  const agg = await prisma.support.aggregate({
    where: { batchId: batch.id, status: "DISBURSED" },
    _sum: { amount: true },
    _count: true,
  });
  const distributed = agg._sum.amount ?? 0;
  return {
    ...batch,
    distributedAmount: distributed,
    distributedCount: agg._count,
    remainingAmount: Math.round((batch.totalAmount - distributed) * 100) / 100,
  };
}

batchesRouter.get("/", async (_req, res) => {
  const items = await prisma.supportBatch.findMany({
    include: { _count: { select: { supports: true } } },
    orderBy: { receivedDate: "desc" },
  });
  const withTotals = await Promise.all(items.map(withRemaining));
  res.json(withTotals);
});

batchesRouter.get("/:id", async (req, res) => {
  const item = await prisma.supportBatch.findUnique({
    where: { id: req.params.id },
    include: { supports: { include: { beneficiary: true }, orderBy: { createdAt: "desc" } } },
  });
  if (!item) return res.status(404).json({ error: "الدفعة غير موجودة" });
  res.json(await withRemaining(item));
});

batchesRouter.post("/", async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const totalAmount = computeTotal(data);
  const receivedDate = new Date(data.receivedDate);
  const defaultTitle = `دعم ${SUPPORT_CATEGORY_AR[data.category] ?? data.category} - ${receivedDate.toLocaleDateString("ar-SA")}`;

  const created = await prisma.supportBatch.create({
    data: {
      title: data.title?.trim() || defaultTitle,
      category: data.category,
      totalAmount,
      quantity: data.quantity ?? null,
      unitPrice: data.unitPrice ?? null,
      receivedDate,
      year: data.year,
      distributionMethod: data.distributionMethod,
      unifiedAmount: data.unifiedAmount ?? null,
      headAmount: data.headAmount ?? null,
      dependentAmount: data.dependentAmount ?? null,
      notes: data.notes ?? null,
      createdById: req.user!.userId,
    },
  });
  res.status(201).json(await withRemaining(created));
});

batchesRouter.put("/:id", async (req, res) => {
  const parsed = batchSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const updated = await prisma.supportBatch.update({
      where: { id: req.params.id },
      data: {
        ...(data.title !== undefined ? { title: data.title || undefined } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
        ...(data.unitPrice !== undefined ? { unitPrice: data.unitPrice } : {}),
        ...(data.totalAmount !== undefined || data.quantity !== undefined || data.unitPrice !== undefined
          ? { totalAmount: computeTotal({ ...data } as any) }
          : {}),
        ...(data.receivedDate !== undefined ? { receivedDate: new Date(data.receivedDate) } : {}),
        ...(data.year !== undefined ? { year: data.year } : {}),
        ...(data.distributionMethod !== undefined ? { distributionMethod: data.distributionMethod } : {}),
        ...(data.unifiedAmount !== undefined ? { unifiedAmount: data.unifiedAmount } : {}),
        ...(data.headAmount !== undefined ? { headAmount: data.headAmount } : {}),
        ...(data.dependentAmount !== undefined ? { dependentAmount: data.dependentAmount } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
    });
    res.json(await withRemaining(updated));
  } catch {
    res.status(404).json({ error: "الدفعة غير موجودة" });
  }
});

batchesRouter.post("/:id/close", async (req, res) => {
  try {
    const updated = await prisma.supportBatch.update({
      where: { id: req.params.id },
      data: { status: "CLOSED" },
    });
    res.json(await withRemaining(updated));
  } catch {
    res.status(404).json({ error: "الدفعة غير موجودة" });
  }
});

batchesRouter.post("/:id/reopen", async (req, res) => {
  try {
    const updated = await prisma.supportBatch.update({
      where: { id: req.params.id },
      data: { status: "OPEN" },
    });
    res.json(await withRemaining(updated));
  } catch {
    res.status(404).json({ error: "الدفعة غير موجودة" });
  }
});

batchesRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.supportBatch.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "الدفعة غير موجودة" });
  }
});

// تنفيذ التوزيع: إنشاء سجل دعم واحد (وسند صرف) لكل مستفيد مُختار بالقيمة المؤكَّدة من الواجهة.
// لا يُمنع التوزيع عند تجاوز الرصيد المتبقي — التحذير غير المانع يظهر في الواجهة قبل التأكيد.
batchesRouter.post("/:id/distribute", async (req, res) => {
  const parsed = distributeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }

  const batch = await prisma.supportBatch.findUnique({ where: { id: req.params.id } });
  if (!batch) return res.status(404).json({ error: "الدفعة غير موجودة" });
  if (batch.status === "CLOSED") {
    return res.status(400).json({ error: "الدفعة مغلقة، لا يمكن التوزيع منها" });
  }

  const { items } = parsed.data;
  const created = await prisma.$transaction(
    items.map((item) =>
      prisma.support.create({
        data: {
          beneficiaryId: item.beneficiaryId,
          category: batch.category,
          amount: item.amount ?? null,
          description: item.description ?? null,
          quantity: item.quantity ?? null,
          supportDate: new Date(),
          year: batch.year,
          status: "DISBURSED",
          batchId: batch.id,
          createdById: req.user!.userId,
        },
      })
    )
  );

  res.status(201).json({ createdCount: created.length, items: created });
});
