import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { SUPPORT_CATEGORY_LABEL } from "../lib/constants";

const currentYear = new Date().getFullYear();

const emptyForm = {
  title: "",
  category: "CASH",
  perPersonRate: "",
  totalBudget: "",
  distributionDate: "",
  year: String(currentYear),
  notes: "",
};

export default function Campaigns() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/campaigns");
      setItems(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openAdd() {
    setForm(emptyForm);
    setError("");
    setShowForm(true);
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
      const created = await api.post("/campaigns", {
        title: form.title || null,
        category: form.category,
        perPersonRate: form.perPersonRate ? Number(form.perPersonRate) : null,
        totalBudget: form.totalBudget ? Number(form.totalBudget) : null,
        distributionDate: new Date(form.distributionDate).toISOString(),
        year: Number(form.year),
        notes: form.notes || null,
      });
      setShowForm(false);
      const preselect = searchParams.get("beneficiaryId");
      navigate(`/campaigns/${created.data.id}${preselect ? `?preselect=${preselect}` : ""}`);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("هل تريد حذف هذه الدفعة؟ (سجلات الدعم المُنشأة منها تبقى محفوظة)")) return;
    await api.delete(`/campaigns/${id}`);
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
        عند وصول دعم (نقدي أو عيني أو غيره)، أنشئ دفعة بنوعه وتاريخه، ثم اختر المستفيدين المشمولين — الجميع أو
        بعضهم — وحدّد لكل واحد المبلغ (يمكن حسابه تلقائياً حسب عدد أفراد الأسرة، أو إدخاله يدوياً).
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
                <th>نصيب الفرد</th>
                <th>تاريخ التوزيع</th>
                <th>عدد المستفيدين المشمولين</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/campaigns/${c.id}`}>{c.title}</Link>
                  </td>
                  <td>{SUPPORT_CATEGORY_LABEL[c.category] ?? c.category}</td>
                  <td>{c.perPersonRate != null ? `${c.perPersonRate.toLocaleString("ar-SA")} ريال` : "-"}</td>
                  <td>{new Date(c.distributionDate).toLocaleDateString("ar-SA")}</td>
                  <td>{c._count.supports}</td>
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
            <h3>دفعة دعم جديدة</h3>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-grid">
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>اسم الدفعة (اختياري)</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="مثال: توزيع دعم شتاء 1447 — يُترك فارغاً للتوليد التلقائي" />
              </div>
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
                <label>نصيب الفرد الواحد من الأسرة (ريال)</label>
                <input type="number" value={form.perPersonRate} onChange={(e) => setForm({ ...form, perPersonRate: e.target.value })} />
              </div>
              <div className="field">
                <label>إجمالي ميزانية الحملة (اختياري)</label>
                <input type="number" value={form.totalBudget} onChange={(e) => setForm({ ...form, totalBudget: e.target.value })} />
              </div>
              <div className="field">
                <label>تاريخ التوزيع *</label>
                <input required type="date" value={form.distributionDate} onChange={(e) => setForm({ ...form, distributionDate: e.target.value })} />
              </div>
              <div className="field">
                <label>السنة *</label>
                <input required type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
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
                إنشاء ومتابعة الاختيار
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
