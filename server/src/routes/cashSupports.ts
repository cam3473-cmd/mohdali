import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const cashSupportsRouter = Router();
cashSupportsRouter.use(requireAuth);

const schema = z.object({
  beneficiaryId: z.string().min(1),
  amount: z.number().positive(),
  type: z.enum(["MONTHLY", "EMERGENCY", "SEASONAL", "OTHER"]).optional(),
  supportDate: z.string().datetime(),
  year: z.number().int(),
  status: z.enum(["PENDING", "DISBURSED", "CANCELLED"]).optional(),
  notes: z.string().optional().nullable(),
});

cashSupportsRouter.get("/", async (req, res) => {
  const { beneficiaryId, year } = req.query as Record<string, string>;
  const where: any = {};
  if (beneficiaryId) where.beneficiaryId = beneficiaryId;
  if (year) where.year = parseInt(year, 10);

  const items = await prisma.cashSupport.findMany({
    where,
    include: { beneficiary: { select: { fullName: true, nationalId: true } } },
    orderBy: { supportDate: "desc" },
  });
  res.json(items);
});

cashSupportsRouter.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const created = await prisma.cashSupport.create({
    data: {
      ...data,
      supportDate: new Date(data.supportDate),
      createdById: req.user!.userId,
    },
  });
  res.status(201).json(created);
});

cashSupportsRouter.put("/:id", async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const updated = await prisma.cashSupport.update({
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

cashSupportsRouter.delete("/:id", async (req, res) => {
  try {
    await prisma.cashSupport.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "السجل غير موجود" });
  }
});
