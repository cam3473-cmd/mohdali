import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const settingsSchema = z.object({
  surveyFormBaseUrl: z.string().optional().nullable(),
  surveyFormEntryParam: z.string().optional().nullable(),
});

function toPublicShape(settings: any) {
  return {
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
      surveyFormBaseUrl: data.surveyFormBaseUrl ?? null,
      surveyFormEntryParam: data.surveyFormEntryParam ?? null,
    },
    update: {
      ...(data.surveyFormBaseUrl !== undefined ? { surveyFormBaseUrl: data.surveyFormBaseUrl } : {}),
      ...(data.surveyFormEntryParam !== undefined ? { surveyFormEntryParam: data.surveyFormEntryParam } : {}),
    },
  });
  res.json(toPublicShape(updated));
});
