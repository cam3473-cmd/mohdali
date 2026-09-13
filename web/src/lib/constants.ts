export const SUPPORT_CATEGORY_LABEL: Record<string, string> = {
  IN_KIND: "عيني",
  CASH: "نقدي",
  HOUSING: "سكني",
  ECONOMIC: "اقتصادي",
  HEALTH: "صحي",
  EDUCATIONAL: "تعليمي",
  SERVICES: "خدمات",
};

export const DISTRIBUTION_METHOD_LABEL: Record<string, string> = {
  UNIFIED: "مبلغ موحّد لكامل الأسرة",
  HEAD_PLUS_DEPENDENTS: "رب الأسرة + مبلغ لكل تابع",
};

// القيمة الافتراضية الذكية لطريقة التوزيع حسب نوع الدعم (قابلة للتغيير دوماً لكل دفعة)
export const DEFAULT_DISTRIBUTION_METHOD: Record<string, string> = {
  IN_KIND: "UNIFIED",
  CASH: "HEAD_PLUS_DEPENDENTS",
  HOUSING: "HEAD_PLUS_DEPENDENTS",
  ECONOMIC: "HEAD_PLUS_DEPENDENTS",
  HEALTH: "HEAD_PLUS_DEPENDENTS",
  EDUCATIONAL: "HEAD_PLUS_DEPENDENTS",
  SERVICES: "UNIFIED",
};

export const SUPPORT_CATEGORIES = Object.keys(SUPPORT_CATEGORY_LABEL);

export const DISBURSEMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "معلّق",
  DISBURSED: "مصروف",
  CANCELLED: "ملغى",
};

export const CASE_TYPE_LABEL: Record<string, string> = {
  INDIVIDUAL: "فرد",
  FAMILY: "أسرة",
};
