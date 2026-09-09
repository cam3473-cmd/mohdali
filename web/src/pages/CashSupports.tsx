import { FormEvent, useEffect, useState } from "react";
import { api, apiErrorMessage, downloadReport } from "../lib/api";
import BeneficiaryPicker from "../components/BeneficiaryPicker";

const CASH_TYPE_LABEL: Record<string, string> = { MONTHLY: "شهري", EMERGENCY: "طارئ", SEASONAL: "موسمي", OTHER: "أخرى" };
const currentYear = new Date().getFullYear();

export default function CashSupports() {
  const [items, setItems] = useState<any[]>([]);
  const [year, setYear] = useState(String(currentYear));
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [beneficiary, setBeneficiary] = useState<{ id: string; fullName: string } | null>(null);
  const [form, setForm] = useState({ amount: "", type: "MONTHLY", supportDate: "", notes: "" });
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/cash-supports", { params: { year: year || undefined } });
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
    setForm({ amount: "", type: "MONTHLY", supportDate: "", notes: "" });
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
      await api.post("/cash-supports", {
        beneficiaryId: beneficiary.id,
        amount: Number(form.amount),
        type: form.type,
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
    await api.delete(`/cash-supports/${id}`);
    load();
  }

  const total = items.reduce((s, c) => s + c.amount, 0);

  return (
    <div>
      <div className="page-header">
        <h2>الدعم النقدي</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn secondary" onClick={() => downloadReport(`/reports/cash-supports.xlsx?year=${year}`, `تقرير_الدعم_النقدي_${year}.xlsx`)}>
            تصدير Excel
          </button>
          <button className="btn" onClick={openAdd}>
            + إضافة دعم نقدي
          </button>
        </div>
      </div>

      <div className="toolbar">
        <label>السنة:</label>
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 100 }} />
        <span style={{ marginRight: "auto", color: "var(--muted)" }}>
          الإجمالي: <strong>{total.toLocaleString("ar-SA")} ريال</strong>
        </span>
      </div>

      <div className="card">
        {loading ? (
          <p className="loading">جارٍ التحميل...</p>
        ) : items.length === 0 ? (
          <p className="empty-state">لا توجد سجلات دعم نقدي</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>المستفيد</th>
                <th>رقم الهوية</th>
                <th>النوع</th>
                <th>المبلغ</th>
                <th>التاريخ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.beneficiary.fullName}</td>
                  <td>{c.beneficiary.nationalId}</td>
                  <td>{CASH_TYPE_LABEL[c.type]}</td>
                  <td>{c.amount.toLocaleString("ar-SA")} ريال</td>
                  <td>{new Date(c.supportDate).toLocaleDateString("ar-SA")}</td>
                  <td>
                    <button className="btn danger small" onClick={() => handleDelete(c.id)}>
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
            <h3>إضافة دعم نقدي</h3>
            {error && <div className="error-banner">{error}</div>}
            <BeneficiaryPicker value={beneficiary} onChange={setBeneficiary} />
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>المبلغ (ريال) *</label>
                <input required type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="field">
                <label>نوع الدعم</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="MONTHLY">شهري</option>
                  <option value="EMERGENCY">طارئ</option>
                  <option value="SEASONAL">موسمي</option>
                  <option value="OTHER">أخرى</option>
                </select>
              </div>
              <div className="field">
                <label>تاريخ الصرف *</label>
                <input required type="date" value={form.supportDate} onChange={(e) => setForm({ ...form, supportDate: e.target.value })} />
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
