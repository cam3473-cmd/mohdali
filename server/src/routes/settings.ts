import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const settingsSchema = z.object({
  smsApiKey: z.string().optional().nullable(),
  smsSenderName: z.string().optional().nullable(),
  surveyFormBaseUrl: z.string().optional().nullable(),
  surveyFormEntryParam: z.string().optional().nullable(),
});

// لا تُعاد قيمة smsApiKey فعلياً للواجهة (يُعاد فقط "تم ضبطه" أو لا)، حتى لا يظهر المفتاح
// السري في استجابة API تُعرض على شاشة يراها كل الموظفين
function toPublicShape(settings: any) {
  return {
    smsApiKeySet: !!settings?.smsApiKey,
    smsSenderName: settings?.smsSenderName ?? "",
    surveyFormBaseUrl: settings?.surveyFormBaseUrl ?? "",
    surveyFormEntryParam: settings?.surveyFormEntryParam ?? "",
  };
}

settingsRouter.get("/", async (_req, res) => {
  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  res.json(toPublicShape(settings));
});

settingsRouter.put("/", async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "بيانات غير صحيحة", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  const updated = await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      // لا يُستبدل مفتاح API بقيمة فارغة إن تُرك الحقل بلا تغيير من الواجهة
      smsApiKey: data.smsApiKey || null,
      smsSenderName: data.smsSenderName ?? null,
      surveyFormBaseUrl: data.surveyFormBaseUrl ?? null,
      surveyFormEntryParam: data.surveyFormEntryParam ?? null,
    },
    update: {
      ...(data.smsApiKey ? { smsApiKey: data.smsApiKey } : {}),
      ...(data.smsSenderName !== undefined ? { smsSenderName: data.smsSenderName } : {}),
      ...(data.surveyFormBaseUrl !== undefined ? { surveyFormBaseUrl: data.surveyFormBaseUrl } : {}),
      ...(data.surveyFormEntryParam !== undefined ? { surveyFormEntryParam: data.surveyFormEntryParam } : {}),
    },
  });
  res.json(toPublicShape(updated));
});
