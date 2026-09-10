import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const supportsRouter = Router();
supportsRouter.use(requireAuth);

// تصنيفات الدعم الموحّدة (يشملها جميعاً المجال الاجتماعي للجمعية)
export const SUPPORT_CATEGORIES = ["IN_KIND", "CASH", "HOUSING", "ECONOMIC", "HEALTH", "EDUCATIONAL"] as const;

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
