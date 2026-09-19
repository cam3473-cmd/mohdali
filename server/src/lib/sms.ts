import { prisma } from "./prisma";

// تكامل مع منصة OurSMS لإرسال الرسائل النصية.
// ملاحظة: الحقول أدناه (المسار، أسماء الحقول) مبنية على الشكل الشائع لبوابات الرسائل
// النصية في المنطقة، ولم تُتحقَّق بعد مقابل وثائق OurSMS الفعلية لحساب الجمعية —
// إن فشل الإرسال بخطأ من المزوّد، راجع وثائق حسابكم في https://oursms.com/en/documentation/
// وعدّل OURSMS_ENDPOINT وبنية الطلب في sendSms() حسب الوثائق الدقيقة.
const OURSMS_ENDPOINT = "https://api.oursms.com/msgs";

export class SmsConfigError extends Error {}
export class SmsSendError extends Error {}

export async function getSmsConfig() {
  const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (!settings?.smsApiKey || !settings.smsSenderName) {
    throw new SmsConfigError("لم يتم ضبط إعدادات الرسائل النصية بعد (مفتاح API واسم المرسل) — راجع شاشة الإعدادات");
  }
  return { apiKey: settings.smsApiKey, senderName: settings.smsSenderName };
}

// يحوّل رقم جوال سعودي محلي (05xxxxxxxx) إلى الصيغة الدولية (9665xxxxxxxx) التي تتطلبها
// أغلب بوابات الرسائل، مع قبول الصيغة الدولية والمحلية بدون فواصل كما هي
function normalizeSaudiPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("966")) return digits;
  if (digits.startsWith("05")) return `966${digits.slice(1)}`;
  if (digits.startsWith("5") && digits.length === 9) return `966${digits}`;
  return digits;
}

export async function sendSms(phone: string, message: string): Promise<void> {
  const { apiKey, senderName } = await getSmsConfig();
  const to = normalizeSaudiPhone(phone);

  const res = await fetch(OURSMS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      src: senderName,
      dests: [to],
      body: message,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SmsSendError(`فشل إرسال الرسالة النصية (${res.status}): ${text || "خطأ غير معروف من المزوّد"}`);
  }
}

// يبني رابط الاستبيان: يضيف معرّف المستفيد كقيمة مسبقة التعبئة في النموذج إن كان اسم
// الحقل مضبوطاً في الإعدادات، وإلا يُعاد الرابط العام كما هو
export function buildSurveyLink(baseUrl: string, entryParam: string | null, referenceId: string): string {
  if (!entryParam) return baseUrl;
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}${entryParam}=${encodeURIComponent(referenceId)}`;
}
