import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const createUserSchema = z.object({
  username: z.string().min(3),
  fullName: z.string().min(1),
  password: z.string().min(6),
});

const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

// جميع الموظفين لديهم صلاحيات كاملة متساوية؛ حساب المستخدم يُستخدم للمساءلة (من أدخل كل عملية)
usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, fullName: true, active: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(users);
});

usersRouter.post("/", async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const { username, fullName, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return res.status(409).json({ error: "اسم المستخدم مستخدم مسبقاً" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const created = await prisma.user.create({
    data: { username, fullName, passwordHash },
    select: { id: true, username: true, fullName: true, active: true, createdAt: true },
  });
  res.status(201).json(created);
});

usersRouter.put("/:id", async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const { password, ...rest } = parsed.data;
  const data: any = { ...rest };
  if (password) {
    data.passwordHash = await bcrypt.hash(password, 10);
  }

  try {
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, username: true, fullName: true, active: true, createdAt: true },
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "المستخدم غير موجود" });
  }
});
