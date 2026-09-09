import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signToken, requireAuth } from "../middleware/auth";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "الرجاء إدخال اسم المستخدم وكلمة المرور" });
  }
  const { username, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active) {
    return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
  }

  const token = signToken({ userId: user.id, username: user.username, fullName: user.fullName });
  res.json({
    token,
    user: { id: user.id, username: user.username, fullName: user.fullName },
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});
