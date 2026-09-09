import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, downloadReport } from "../lib/api";

const CATEGORY_LABEL: Record<string, string> = {
  COMPUTER: "حاسب آلي",
  LANGUAGES: "لغات",
  AI: "ذكاء اصطناعي",
  LIFE_SKILLS: "مهارات حياتية",
  OTHER: "أخرى",
};

const emptyForm = {
  title: "",
  category: "COMPUTER",
  trainer: "",
  startDate: "",
  endDate: "",
  seatsCount: "",
  location: "",
  notes: "",
};

export default function Courses() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/courses");
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/courses", {
        title: form.title,
        category: form.category,
        trainer: form.trainer || null,
        startDate: new Date(form.startDate).toISOString(),
        endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
        seatsCount: form.seatsCount ? Number(form.seatsCount) : null,
        location: form.location || null,
        notes: form.notes || null,
      });
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("هل تريد حذف هذه الدورة وجميع تسجيلات المستفيدين بها؟")) return;
    await api.delete(`/courses/${id}`);
    load();
  }

  return (
    <div>
      <div className="page-header">
        <h2>الدورات التدريبية</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn secondary" onClick={() => downloadReport("/reports/courses.xlsx", "تقرير_الدورات_التدريبية.xlsx")}>
            تصدير Excel
          </button>
          <button className="btn" onClick={openAdd}>
            + إضافة دورة
          </button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p className="loading">جارٍ التحميل...</p>
        ) : items.length === 0 ? (
          <p className="empty-state">لا توجد دورات مضافة</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>اسم الدورة</th>
                <th>الفئة</th>
                <th>المدرب</th>
                <th>تاريخ البدء</th>
                <th>عدد المسجلين</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/courses/${c.id}`}>{c.title}</Link>
                  </td>
                  <td>{CATEGORY_LABEL[c.category]}</td>
                  <td>{c.trainer || "-"}</td>
                  <td>{new Date(c.startDate).toLocaleDateString("ar-SA")}</td>
                  <td>{c._count.enrollments}</td>
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
            <h3>إضافة دورة تدريبية</h3>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-grid">
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>اسم الدورة *</label>
                <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="field">
                <label>الفئة</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>المدرب</label>
                <input value={form.trainer} onChange={(e) => setForm({ ...form, trainer: e.target.value })} />
              </div>
              <div className="field">
                <label>تاريخ البدء *</label>
                <input required type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="field">
                <label>تاريخ الانتهاء</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
              <div className="field">
                <label>عدد المقاعد</label>
                <input type="number" value={form.seatsCount} onChange={(e) => setForm({ ...form, seatsCount: e.target.value })} />
              </div>
              <div className="field">
                <label>مكان الانعقاد</label>
                <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
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
