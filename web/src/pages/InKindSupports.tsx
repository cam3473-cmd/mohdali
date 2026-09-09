import { FormEvent, useEffect, useState } from "react";
import { api, apiErrorMessage, downloadReport } from "../lib/api";
import BeneficiaryPicker from "../components/BeneficiaryPicker";

const CATEGORY_LABEL: Record<string, string> = {
  FOOD: "مواد غذائية",
  CLOTHING: "ملابس",
  FURNITURE: "أثاث",
  DEVICES: "أجهزة",
  MEDICAL: "مستلزمات طبية",
  SCHOOL: "مستلزمات مدرسية",
  OTHER: "أخرى",
};
const currentYear = new Date().getFullYear();

export default function InKindSupports() {
  const [items, setItems] = useState<any[]>([]);
  const [year, setYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [beneficiary, setBeneficiary] = useState<{ id: string; fullName: string } | null>(null);
  const [form, setForm] = useState({ category: "FOOD", description: "", quantity: "1", estimatedValue: "", supportDate: "" });
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/in-kind-supports", { params: { year: year || undefined } });
      setItems(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  function openAdd() {
    setBeneficiary(null);
    setForm({ category: "FOOD", description: "", quantity: "1", estimatedValue: "", supportDate: "" });
    setError("");
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!beneficiary) {
      setError("الرجاء اختيار المستفيد");
      return;
    }
    setError("");
    try {
      await api.post("/in-kind-supports", {
        beneficiaryId: beneficiary.id,
        category: form.category,
        description: form.description,
        quantity: Number(form.quantity),
        estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : null,
        supportDate: new Date(form.supportDate).toISOString(),
        year: Number(year) || currentYear,
      });
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("هل تريد حذف سجل الدعم هذا؟")) return;
    await api.delete(`/in-kind-supports/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>الدعم العيني</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn secondary" onClick={() => downloadReport(`/reports/in-kind-supports.xlsx?year=${year}`, `تقرير_الدعم_العيني_${year}.xlsx`)}>
            تصدير Excel
          </button>
          <button className="btn" onClick={openAdd}>
            + إضافة دعم عيني
          </button>
        </div>
      </div>

      <div className="toolbar">
        <label>السنة:</label>
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 100 }} />
      </div>

      <div className="card">
        {loading ? (
          <p className="loading">جارٍ التحميل...</p>
        ) : items.length === 0 ? (
          <p className="empty-state">لا توجد سجلات دعم عيني</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>المستفيد</th>
                <th>التصنيف</th>
                <th>الوصف</th>
                <th>الكمية</th>
                <th>القيمة التقديرية</th>
                <th>التاريخ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>{s.beneficiary.fullName}</td>
                  <td>{CATEGORY_LABEL[s.category]}</td>
                  <td>{s.description}</td>
                  <td>{s.quantity}</td>
                  <td>{s.estimatedValue ? `${s.estimatedValue.toLocaleString("ar-SA")} ريال` : "-"}</td>
                  <td>{new Date(s.supportDate).toLocaleDateString("ar-SA")}</td>
                  <td>
                    <button className="btn danger small" onClick={() => handleDelete(s.id)}>
                      حذف
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
            <h3>إضافة دعم عيني</h3>
            {error && <div className="error-banner">{error}</div>}
            <BeneficiaryPicker value={beneficiary} onChange={setBeneficiary} />
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>التصنيف</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>الوصف *</label>
                <input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="field">
                <label>الكمية</label>
                <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div className="field">
                <label>القيمة التقديرية (ريال)</label>
                <input type="number" value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} />
              </div>
              <div className="field">
                <label>تاريخ التسليم *</label>
                <input required type="date" value={form.supportDate} onChange={(e) => setForm({ ...form, supportDate: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>
                إلغاء
              </button>
              <button type="submit" className="btn">
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
