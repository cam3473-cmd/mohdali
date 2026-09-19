// لا يرسل النظام الرسائل النصية آلياً — منصة الرسائل مشتركة بين عدة جهات وليست حساباً
// خاصاً بالجمعية، فيُفضَّل أن يتولى الموظف الإرسال يدوياً من بوابة المنصة كالمعتاد.
// هذا الملف يبني فقط رابط الاستبيان الشخصي لكل مستفيد، يُصدَّر لاحقاً كملف Excel.

// يبني رابط الاستبيان: يضيف معرّف المستفيد كقيمة مسبقة التعبئة في النموذج إن كان اسم
// الحقل مضبوطاً في الإعدادات، وإلا يُعاد الرابط العام كما هو
export function buildSurveyLink(baseUrl: string, entryParam: string | null, referenceId: string): string {
  if (!entryParam) return baseUrl;
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}${entryParam}=${encodeURIComponent(referenceId)}`;
}
