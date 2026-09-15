// تحويل الأرقام العربية (٠-٩) والفارسية (۰-۹) إلى أرقام إنجليزية عادية.
// ضروري لأن حقول <input type="number"> ترفض الأرقام العربية تماماً على لوحات المفاتيح
// العربية (يبدو الحقل معطّلاً ولا يقبل إلا أزرار الزيادة/النقص) — لذلك نستخدم حقول نصية
// عادية مع هذا التحويل بدل الاعتماد على النوع "number" في المتصفح.
const DIGIT_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

export function toAsciiDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d);
}

// يبقي فقط الأرقام ونقطة عشرية واحدة، بعد تحويل الأرقام العربية إلى إنجليزية
export function sanitizeNumericInput(input: string): string {
  const ascii = toAsciiDigits(input);
  const cleaned = ascii.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}
