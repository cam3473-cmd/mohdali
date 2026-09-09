import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const beneficiariesRouter = Router();
beneficiariesRouter.use(requireAuth);

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
      cashSupports: { orderBy: { supportDate: "desc" } },
      inKindSupports: { orderBy: { supportDate: "desc" } },
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
  } catch {
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
