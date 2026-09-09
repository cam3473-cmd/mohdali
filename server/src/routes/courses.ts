import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const coursesRouter = Router();
coursesRouter.use(requireAuth);

const courseSchema = z.object({
  title: z.string().min(1),
  category: z.enum(["COMPUTER", "LANGUAGES", "AI", "LIFE_SKILLS", "OTHER"]),
  trainer: z.string().optional().nullable(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional().nullable(),
  seatsCount: z.number().int().positive().optional().nullable(),
  location: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const enrollmentSchema = z.object({
  beneficiaryId: z.string().min(1),
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
    include: { _count: { select: { enrollments: true } } },
    orderBy: { startDate: "desc" },
  });
  res.json(items);
});

coursesRouter.get("/:id", async (req, res) => {
  const item = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: { enrollments: { include: { beneficiary: true } } },
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

// تسجيل مستفيد في دورة
coursesRouter.post("/:id/enrollments", async (req, res) => {
  const parsed = enrollmentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;

  const existing = await prisma.courseEnrollment.findUnique({
    where: { beneficiaryId_courseId: { beneficiaryId: data.beneficiaryId, courseId: req.params.id } },
  });
  if (existing) {
    return res.status(409).json({ error: "المستفيد مسجل مسبقاً في هذه الدورة" });
  }

  try {
    const created = await prisma.courseEnrollment.create({
      data: {
        ...data,
        courseId: req.params.id,
        createdById: req.user!.userId,
      },
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "المستفيد مسجل مسبقاً في هذه الدورة" });
    }
    if (err?.code === "P2003") {
      return res.status(400).json({ error: "الدورة أو المستفيد غير موجود" });
    }
    res.status(400).json({ error: "تعذر تسجيل المستفيد في الدورة" });
  }
});

coursesRouter.put("/enrollments/:enrollmentId", async (req, res) => {
  const parsed = enrollmentSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  try {
    const updated = await prisma.courseEnrollment.update({
      where: { id: req.params.enrollmentId },
      data: parsed.data,
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "السجل غير موجود" });
  }
});

coursesRouter.delete("/enrollments/:enrollmentId", async (req, res) => {
  try {
    await prisma.courseEnrollment.delete({ where: { id: req.params.enrollmentId } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: "السجل غير موجود" });
  }
});
