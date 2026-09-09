import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { resolveJwtSecret } from "../lib/secret";

const JWT_SECRET = resolveJwtSecret();

export interface AuthPayload {
  userId: string;
  username: string;
  fullName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "غير مصرح، الرجاء تسجيل الدخول" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    // إعادة التحقق من الحساب في قاعدة البيانات في كل طلب، حتى يسري تعطيل الموظف فوراً
    // بدل انتظار انتهاء صلاحية الجلسة (12 ساعة) التي لا تعكس حالة تعطيله.
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { active: true } });
    if (!user || !user.active) {
      return res.status(401).json({ error: "الحساب معطل أو غير موجود" });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "الجلسة غير صالحة أو منتهية" });
  }
}
