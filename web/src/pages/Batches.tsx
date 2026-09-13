import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { SUPPORT_CATEGORY_LABEL, DISTRIBUTION_METHOD_LABEL, DEFAULT_DISTRIBUTION_METHOD } from "../lib/constants";

const currentYear = new Date().getFullYear();

function emptyFormFor(category: string) {
  return {
    title: "",
    category,
    totalAmount: "",
    quantity: "",
    unitPrice: "",
    receivedDate: "",
    year: String(currentYear),
    distributionMethod: DEFAULT_DISTRIBUTION_METHOD[category] ?? "HEAD_PLUS_DEPENDENTS",
    unifiedAmount: "",
    headAmount: "",
    dependentAmount: "",
    notes: "",
  };
}

export default function Batches() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyFormFor("CASH"));
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/batches");
      setItems(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openAdd() {
    setForm(emptyFormFor("CASH"));
    setError("");
    setShowForm(true);
  }

  function onCategoryChange(category: string) {
    setForm((f) => ({ ...f, category, distributionMethod: DEFAULT_DISTRIBUTION_METHOD[category] ?? f.distributionMethod }));
  }

  useEffect(() => {
    if (searchParams.get("new") === "1") {
      openAdd();
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const created = await api.post("/batches", {
        title: form.title || null,
        category: form.category,
        totalAmount: form.totalAmount ? Number(form.totalAmount) : null,
        quantity: form.quantity ? Number(form.quantity) : null,
        unitPrice: form.unitPrice ? Number(form.unitPrice) : null,
        receivedDate: new Date(form.receivedDate).toISOString(),
        year: Number(form.year),
        distributionMethod: form.distributionMethod,
        unifiedAmount: form.unifiedAmount ? Number(form.unifiedAmount) : null,
        headAmount: form.headAmount ? Number(form.headAmount) : null,
        dependentAmount: form.dependentAmount ? Number(form.dependentAmount) : null,
        notes: form.notes || null,
      });
      setShowForm(false);
      const preselect = searchParams.get("beneficiaryId");
      navigate(`/batches/${created.data.id}${preselect ? `?preselect=${preselect}` : ""}`);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("هل تريد حذف هذه الدفعة؟ (سجلات الدعم المُنشأة منها تبقى محفوظة)")) return;
    await api.delete(`/batches/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>دفعات الدعم</h2>
        <button className="btn" onClick={openAdd}>
          + دفعة دعم جديدة
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 14, marginTop: -10 }}>
        عند وصول دعم، سجّله أولاً كدفعة برصيد إجمالي — ثم وزّعه لاحقاً على من تشملهم (فوراً أو على جلسات متعددة)
        حتى ينفد أو تُغلقه يدوياً.
      </p>

      <div className="card">
        {loading ? (
          <p className="loading">جارٍ التحميل...</p>
        ) : items.length === 0 ? (
          <p className="empty-state">لا توجد دفعات بعد</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>اسم الدفعة</th>
                <th>النوع</th>
                <th>الإجمالي</th>
                <th>المتبقي</th>
                <th>الحالة</th>
                <th>تاريخ الاستلام</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} style={b.status === "CLOSED" ? { opacity: 0.6 } : undefined}>
                  <td>
                    <Link to={`/batches/${b.id}`}>{b.title}</Link>
                  </td>
                  <td>{SUPPORT_CATEGORY_LABEL[b.category] ?? b.category}</td>
                  <td>{b.totalAmount.toLocaleString("ar-SA")} ريال</td>
                  <td>{b.remainingAmount.toLocaleString("ar-SA")} ريال</td>
                  <td>{b.status === "OPEN" ? "مفتوحة" : "مغلقة"}</td>
                  <td>{new Date(b.receivedDate).toLocaleDateString("ar-SA")}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <Link to={`/batches/${b.id}/receipt`} className="btn secondary small">
                      سند استلام
                    </Link>
                    <button className="btn danger small" onClick={() => handleDelete(b.id)}>
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
            <h3>دفعة دعم جديدة (تسجيل الوارد)</h3>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-grid">
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>اسم الدفعة (اختياري)</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="يُترك فارغاً للتوليد التلقائي" />
              </div>
              <div className="field">
                <label>نوع الدعم</label>
                <select value={form.category} onChange={(e) => onCategoryChange(e.target.value)}>
                  {Object.entries(SUPPORT_CATEGORY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>تاريخ الاستلام *</label>
                <input required type="date" value={form.receivedDate} onChange={(e) => setForm({ ...form, receivedDate: e.target.value })} />
              </div>
              <div className="field">
                <label>السنة *</label>
                <input required type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
              </div>

              <div className="field">
                <label>المبلغ الإجمالي المباشر (ريال)</label>
                <input type="number" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} placeholder="للنقدي عادة" />
              </div>
              <div className="field">
                <label>عدد الوحدات (للعيني)</label>
                <input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
              </div>
              <div className="field">
                <label>سعر الوحدة (للعيني)</label>
                <input type="number" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
              </div>
              {form.quantity && form.unitPrice && (
                <div className="field" style={{ gridColumn: "1 / -1", fontSize: 13, color: "var(--muted)" }}>
                  الإجمالي المحسوب: {(Number(form.quantity) * Number(form.unitPrice)).toLocaleString("ar-SA")} ريال
                </div>
              )}

              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>طريقة التوزيع لهذه الدفعة</label>
                <select value={form.distributionMethod} onChange={(e) => setForm({ ...form, distributionMethod: e.target.value })}>
                  {Object.entries(DISTRIBUTION_METHOD_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              {form.distributionMethod === "UNIFIED" ? (
                <div className="field">
                  <label>المبلغ/القيمة الموحّدة لكامل الأسرة</label>
                  <input type="number" value={form.unifiedAmount} onChange={(e) => setForm({ ...form, unifiedAmount: e.target.value })} />
                </div>
              ) : (
                <>
                  <div className="field">
                    <label>مبلغ رب الأسرة</label>
                    <input type="number" value={form.headAmount} onChange={(e) => setForm({ ...form, headAmount: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>مبلغ كل تابع</label>
                    <input type="number" value={form.dependentAmount} onChange={(e) => setForm({ ...form, dependentAmount: e.target.value })} />
                  </div>
                </>
              )}

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
                تسجيل ومتابعة التوزيع
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
