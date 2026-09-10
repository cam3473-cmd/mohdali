import { FormEvent, useEffect, useState } from "react";
import { api, apiErrorMessage, downloadReport } from "../lib/api";
import BeneficiaryPicker from "../components/BeneficiaryPicker";
import { SUPPORT_CATEGORY_LABEL, DISBURSEMENT_STATUS_LABEL } from "../lib/constants";

const currentYear = new Date().getFullYear();

export default function Supports() {
  const [items, setItems] = useState<any[]>([]);
  const [year, setYear] = useState(String(currentYear));
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [beneficiary, setBeneficiary] = useState<{ id: string; fullName: string } | null>(null);
  const [form, setForm] = useState({ category: "CASH", amount: "", description: "", quantity: "", supportDate: "", notes: "" });
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/supports", { params: { year: year || undefined, category: category || undefined } });
      setItems(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, category]);

  function openAdd() {
    setBeneficiary(null);
    setForm({ category: "CASH", amount: "", description: "", quantity: "", supportDate: "", notes: "" });
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
      await api.post("/supports", {
        beneficiaryId: beneficiary.id,
        category: form.category,
        amount: form.amount ? Number(form.amount) : null,
        description: form.description || null,
        quantity: form.quantity ? Number(form.quantity) : null,
        supportDate: new Date(form.supportDate).toISOString(),
        year: Number(year) || currentYear,
        notes: form.notes || null,
      });
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("هل تريد حذف سجل الدعم هذا؟")) return;
    await api.delete(`/supports/${id}`);
    load();
  }

  const total = items.filter((s) => s.status === "DISBURSED").reduce((sum, s) => sum + (s.amount ?? 0), 0);

  return (
    <div>
      <div className="page-header">
        <h2>الدعوم</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn secondary"
            onClick={() =>
              downloadReport(
                `/reports/supports.xlsx?year=${year}${category ? `&category=${category}` : ""}`,
                `تقرير_الدعوم_${year}.xlsx`
              )
            }
          >
            تصدير Excel
          </button>
          <button className="btn" onClick={openAdd}>
            + إضافة دعم
          </button>
        </div>
      </div>

      <div className="toolbar">
        <label>السنة:</label>
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 100 }} />
        <label>النوع:</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">كل الأنواع</option>
          {Object.entries(SUPPORT_CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span style={{ marginRight: "auto", color: "var(--muted)" }}>
          إجمالي المصروف: <strong>{total.toLocaleString("ar-SA")} ريال</strong>
        </span>
      </div>

      <div className="card">
        {loading ? (
          <p className="loading">جارٍ التحميل...</p>
        ) : items.length === 0 ? (
          <p className="empty-state">لا توجد سجلات دعم</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>المستفيد</th>
                <th>النوع</th>
                <th>المبلغ</th>
                <th>الوصف</th>
                <th>الحالة</th>
                <th>التاريخ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>{s.beneficiary.fullName}</td>
                  <td>{SUPPORT_CATEGORY_LABEL[s.category] ?? s.category}</td>
                  <td>{s.amount != null ? `${s.amount.toLocaleString("ar-SA")} ريال` : "-"}</td>
                  <td>{s.description || "-"}</td>
                  <td>{DISBURSEMENT_STATUS_LABEL[s.status] ?? s.status}</td>
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
            <h3>إضافة دعم</h3>
            {error && <div className="error-banner">{error}</div>}
            <BeneficiaryPicker value={beneficiary} onChange={setBeneficiary} />
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>نوع الدعم</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {Object.entries(SUPPORT_CATEGORY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>المبلغ (ريال)</label>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="field">
                <label>تاريخ الصرف *</label>
                <input required type="date" value={form.supportDate} onChange={(e) => setForm({ ...form, supportDate: e.target.value })} />
              </div>
              <div className="field">
                <label>الكمية (للدعم العيني)</label>
                <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>الوصف</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>ملاحظات</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
