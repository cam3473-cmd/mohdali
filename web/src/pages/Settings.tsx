import { FormEvent, useEffect, useState } from "react";
import { api, apiErrorMessage } from "../lib/api";

const emptyForm = {
  smsApiKey: "",
  smsSenderName: "",
  surveyFormBaseUrl: "",
  surveyFormEntryParam: "",
};

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [smsApiKeySet, setSmsApiKeySet] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/settings");
      setSmsApiKeySet(res.data.smsApiKeySet);
      setForm({
        smsApiKey: "",
        smsSenderName: res.data.smsSenderName ?? "",
        surveyFormBaseUrl: res.data.surveyFormBaseUrl ?? "",
        surveyFormEntryParam: res.data.surveyFormEntryParam ?? "",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    try {
      const res = await api.put("/settings", form);
      setSmsApiKeySet(res.data.smsApiKeySet);
      setForm((f) => ({ ...f, smsApiKey: "" }));
      setSaved(true);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  if (loading) return <p className="loading">جارٍ التحميل...</p>;

  return (
    <div>
      <div className="page-header">
        <h2>الإعدادات</h2>
      </div>

      <form className="card" onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
        <h3 style={{ marginTop: 0, fontSize: 15 }}>استبيان قياس رضا المستفيدين</h3>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -6 }}>
          يُرسل رابط الاستبيان عبر رسالة نصية للمستفيد بعد استلام الدعم، من شاشة "الدعوم".
        </p>
        {error && <div className="error-banner">{error}</div>}
        {saved && <div className="success-banner">تم الحفظ بنجاح</div>}

        <div className="form-grid">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>رابط نموذج الاستبيان (Google Forms أو غيره)</label>
            <input
              value={form.surveyFormBaseUrl}
              onChange={(e) => setForm({ ...form, surveyFormBaseUrl: e.target.value })}
              placeholder="https://docs.google.com/forms/d/e/.../viewform"
            />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>اسم حقل الرقم المرجعي في النموذج (اختياري)</label>
            <input
              value={form.surveyFormEntryParam}
              onChange={(e) => setForm({ ...form, surveyFormEntryParam: e.target.value })}
              placeholder="entry.1234567890"
            />
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              إن تُرك فارغاً، يُرسَل نفس الرابط العام لجميع المستفيدين دون تخصيص لكل شخص.
            </span>
          </div>
        </div>

        <h3 style={{ fontSize: 15 }}>منصة الرسائل النصية (OurSMS)</h3>
        <div className="form-grid">
          <div className="field">
            <label>مفتاح API {smsApiKeySet && <span style={{ color: "var(--muted)", fontSize: 12 }}>(مضبوط حالياً)</span>}</label>
            <input
              type="password"
              value={form.smsApiKey}
              onChange={(e) => setForm({ ...form, smsApiKey: e.target.value })}
              placeholder={smsApiKeySet ? "اتركه فارغاً للإبقاء على المفتاح الحالي" : ""}
            />
          </div>
          <div className="field">
            <label>اسم المرسل</label>
            <input value={form.smsSenderName} onChange={(e) => setForm({ ...form, smsSenderName: e.target.value })} />
          </div>
        </div>

        <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
          <button type="submit" className="btn">
            حفظ الإعدادات
          </button>
        </div>
      </form>
    </div>
  );
}
