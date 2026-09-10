export const SUPPORT_CATEGORY_LABEL: Record<string, string> = {
  IN_KIND: "عيني",
  CASH: "نقدي",
  HOUSING: "سكني",
  ECONOMIC: "اقتصادي",
  HEALTH: "صحي",
  EDUCATIONAL: "تعليمي",
};

export const SUPPORT_CATEGORIES = Object.keys(SUPPORT_CATEGORY_LABEL);

export const DISBURSEMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "معلّق",
  DISBURSED: "مصروف",
  CANCELLED: "ملغى",
};
