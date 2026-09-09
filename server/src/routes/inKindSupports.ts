import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const inKindSupportsRouter = Router();
inKindSupportsRouter.use(requireAuth);

const schema = z.object({
  beneficiaryId: z.string().min(1),
  category: z.enum(["FOOD", "CLOTHING", "FURNITURE", "DEVICES", "MEDICAL", "SCHOOL", "OTHER"]),
  description: z.string().min(1),
  quantity: z.number().int().positive().optional(),
  estimatedValue: z.number().nonnegative().optional().nullable(),
  supportDate: z.string().datetime(),
  year: z.number().int(),
  notes: z.string().optional().nullable(),
});

inKindSupportsRouter.get("/", async (req, res) => {
  const { beneficiaryId, year, category } = req.query as Record<string, string>;
  const where: any = {};
  if (beneficiaryId) where.beneficiaryId = beneficiaryId;
  if (year) where.year = parseInt(year, 10);
  if (category) where.category = category;

  const items = await prisma.inKindSupport.findMany({
    where,
    include: { beneficiary: { select: { fullName: true, nationalId: true } } },
    orderBy: { supportDate: "desc" },
  });
  res.json(items);
});

inKindSupportsRouter.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const created = await prisma.inKindSupport.create({
    data: {
      ...data,
      supportDate: new Date(data.supportDate),
      createdById: req.user!.userId,
    },
  });
  res.status(201).json(created);
});

inKindSupportsRouter.put("/:id", async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const updated = await prisma.inKindSupport.update({
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

inKindSupportsRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.inKindSupport.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "السجل غير موجود" });
  }
});
