import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { SUPPORT_CATEGORY_LABEL, DISBURSEMENT_STATUS_LABEL } from "../lib/constants";

const ENROLLMENT_STATUS_LABEL: Record<string, string> = { ENROLLED: "مسجل", COMPLETED: "أكمل", DROPPED: "منسحب" };

export default function BeneficiaryDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<"supports" | "courses">("supports");
  const [loading, setLoading] = useState(true);

  const [showSupportForm, setShowSupportForm] = useState(false);
  const [error, setError] = useState("");

  const currentYear = new Date().getFullYear();

  const [supportForm, setSupportForm] = useState({
    category: "CASH",
    amount: "",
    description: "",
    quantity: "",
    supportDate: "",
    year: String(currentYear),
    notes: "",
  });

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/beneficiaries/${id}`);
      setData(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function submitSupport(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/supports", {
        beneficiaryId: id,
        category: supportForm.category,
        amount: supportForm.amount ? Number(supportForm.amount) : null,
        description: supportForm.description || null,
        quantity: supportForm.quantity ? Number(supportForm.quantity) : null,
        supportDate: new Date(supportForm.supportDate).toISOString(),
        year: Number(supportForm.year),
        notes: supportForm.notes || null,
      });
      setShowSupportForm(false);
      setSupportForm({ category: "CASH", amount: "", description: "", quantity: "", supportDate: "", year: String(currentYear), notes: "" });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  if (loading || !data) return <p className="loading">جارٍ التحميل...</p>;

  return (
    <div>
      <div className="page-header">
        <h2>{data.fullName}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/beneficiaries/${id}/card`} className="btn secondary">
            بطاقة المستفيد
          </Link>
          <Link to="/beneficiaries" className="btn secondary">
            رجوع إلى القائمة
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="form-grid">
          <div>
            <strong>رقم الهوية:</strong> {data.nationalId}
          </div>
          <div>
            <strong>الجوال:</strong> {data.phone || "-"}
          </div>
          <div>
            <strong>الحي:</strong> {data.neighborhood || "-"}
          </div>
          <div>
            <strong>تصنيف الاحتياج:</strong> {data.needCategory || "-"}
          </div>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "supports" ? "active" : ""} onClick={() => setTab("supports")}>
          الدعوم ({data.supports.length})
        </button>
        <button className={tab === "courses" ? "active" : ""} onClick={() => setTab("courses")}>
          الدورات التدريبية ({data.enrollments.length})
        </button>
      </div>

      {tab === "supports" && (
        <div className="card">
          <div className="page-header">
            <h3 style={{ margin: 0, fontSize: 15 }}>سجل الدعوم</h3>
            <button className="btn small" onClick={() => setShowSupportForm(true)}>
              + إضافة دعم
            </button>
          </div>
          {data.supports.length === 0 ? (
            <p className="empty-state">لا توجد سجلات دعم</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>النوع</th>
                  <th>المبلغ</th>
                  <th>الوصف</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {data.supports.map((s: any) => (
                  <tr key={s.id}>
                    <td>{new Date(s.supportDate).toLocaleDateString("ar-SA")}</td>
                    <td>{SUPPORT_CATEGORY_LABEL[s.category] ?? s.category}</td>
                    <td>{s.amount != null ? `${s.amount.toLocaleString("ar-SA")} ريال` : "-"}</td>
                    <td>{s.description || "-"}</td>
                    <td>{DISBURSEMENT_STATUS_LABEL[s.status] ?? s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "courses" && (
        <div className="card">
          <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>الدورات المسجل بها</h3>
          {data.enrollments.length === 0 ? (
            <p className="empty-state">لا توجد تسجيلات في دورات</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الدورة</th>
                  <th>الحالة</th>
                  <th>الشهادة</th>
                </tr>
              </thead>
              <tbody>
                {data.enrollments.map((e: any) => (
                  <tr key={e.id}>
                    <td>{e.course.title}</td>
                    <td>{ENROLLMENT_STATUS_LABEL[e.status]}</td>
                    <td>{e.certificateIssued ? "صدرت" : "لم تصدر"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showSupportForm && (
        <div className="modal-backdrop" onClick={() => setShowSupportForm(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submitSupport}>
            <h3>إضافة دعم</h3>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-grid">
              <div className="field">
                <label>نوع الدعم</label>
                <select value={supportForm.category} onChange={(e) => setSupportForm({ ...supportForm, category: e.target.value })}>
                  {Object.entries(SUPPORT_CATEGORY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>المبلغ (ريال)</label>
                <input type="number" value={supportForm.amount} onChange={(e) => setSupportForm({ ...supportForm, amount: e.target.value })} />
              </div>
              <div className="field">
                <label>تاريخ الصرف *</label>
                <input
                  required
                  type="date"
                  value={supportForm.supportDate}
                  onChange={(e) => setSupportForm({ ...supportForm, supportDate: e.target.value })}
                />
              </div>
              <div className="field">
                <label>السنة *</label>
                <input required type="number" value={supportForm.year} onChange={(e) => setSupportForm({ ...supportForm, year: e.target.value })} />
              </div>
              <div className="field">
                <label>الكمية (للدعم العيني)</label>
                <input type="number" value={supportForm.quantity} onChange={(e) => setSupportForm({ ...supportForm, quantity: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>الوصف</label>
                <input value={supportForm.description} onChange={(e) => setSupportForm({ ...supportForm, description: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>ملاحظات</label>
                <textarea rows={2} value={supportForm.notes} onChange={(e) => setSupportForm({ ...supportForm, notes: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowSupportForm(false)}>
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
