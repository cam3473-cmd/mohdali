import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";

const CASH_TYPE_LABEL: Record<string, string> = { MONTHLY: "شهري", EMERGENCY: "طارئ", SEASONAL: "موسمي", OTHER: "أخرى" };
const IN_KIND_CATEGORY_LABEL: Record<string, string> = {
  FOOD: "مواد غذائية",
  CLOTHING: "ملابس",
  FURNITURE: "أثاث",
  DEVICES: "أجهزة",
  MEDICAL: "مستلزمات طبية",
  SCHOOL: "مستلزمات مدرسية",
  OTHER: "أخرى",
};
const ENROLLMENT_STATUS_LABEL: Record<string, string> = { ENROLLED: "مسجل", COMPLETED: "أكمل", DROPPED: "منسحب" };

export default function BeneficiaryDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<"cash" | "inkind" | "courses">("cash");
  const [loading, setLoading] = useState(true);

  const [showCashForm, setShowCashForm] = useState(false);
  const [showInKindForm, setShowInKindForm] = useState(false);
  const [error, setError] = useState("");

  const currentYear = new Date().getFullYear();

  const [cashForm, setCashForm] = useState({ amount: "", type: "MONTHLY", supportDate: "", year: String(currentYear), notes: "" });
  const [inKindForm, setInKindForm] = useState({
    category: "FOOD",
    description: "",
    quantity: "1",
    estimatedValue: "",
    supportDate: "",
    year: String(currentYear),
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

  async function submitCash(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/cash-supports", {
        beneficiaryId: id,
        amount: Number(cashForm.amount),
        type: cashForm.type,
        supportDate: new Date(cashForm.supportDate).toISOString(),
        year: Number(cashForm.year),
        notes: cashForm.notes || null,
      });
      setShowCashForm(false);
      setCashForm({ amount: "", type: "MONTHLY", supportDate: "", year: String(currentYear), notes: "" });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function submitInKind(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/in-kind-supports", {
        beneficiaryId: id,
        category: inKindForm.category,
        description: inKindForm.description,
        quantity: Number(inKindForm.quantity),
        estimatedValue: inKindForm.estimatedValue ? Number(inKindForm.estimatedValue) : null,
        supportDate: new Date(inKindForm.supportDate).toISOString(),
        year: Number(inKindForm.year),
      });
      setShowInKindForm(false);
      setInKindForm({ category: "FOOD", description: "", quantity: "1", estimatedValue: "", supportDate: "", year: String(currentYear) });
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
        <Link to="/beneficiaries" className="btn secondary">
          رجوع إلى القائمة
        </Link>
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
        <button className={tab === "cash" ? "active" : ""} onClick={() => setTab("cash")}>
          الدعم النقدي ({data.cashSupports.length})
        </button>
        <button className={tab === "inkind" ? "active" : ""} onClick={() => setTab("inkind")}>
          الدعم العيني ({data.inKindSupports.length})
        </button>
        <button className={tab === "courses" ? "active" : ""} onClick={() => setTab("courses")}>
          الدورات التدريبية ({data.enrollments.length})
        </button>
      </div>

      {tab === "cash" && (
        <div className="card">
          <div className="page-header">
            <h3 style={{ margin: 0, fontSize: 15 }}>سجل الدعم النقدي</h3>
            <button className="btn small" onClick={() => setShowCashForm(true)}>
              + إضافة دعم نقدي
            </button>
          </div>
          {data.cashSupports.length === 0 ? (
            <p className="empty-state">لا توجد سجلات دعم نقدي</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>النوع</th>
                  <th>المبلغ</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {data.cashSupports.map((c: any) => (
                  <tr key={c.id}>
                    <td>{new Date(c.supportDate).toLocaleDateString("ar-SA")}</td>
                    <td>{CASH_TYPE_LABEL[c.type]}</td>
                    <td>{c.amount.toLocaleString("ar-SA")} ريال</td>
                    <td>{c.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "inkind" && (
        <div className="card">
          <div className="page-header">
            <h3 style={{ margin: 0, fontSize: 15 }}>سجل الدعم العيني</h3>
            <button className="btn small" onClick={() => setShowInKindForm(true)}>
              + إضافة دعم عيني
            </button>
          </div>
          {data.inKindSupports.length === 0 ? (
            <p className="empty-state">لا توجد سجلات دعم عيني</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>التصنيف</th>
                  <th>الوصف</th>
                  <th>الكمية</th>
                  <th>القيمة التقديرية</th>
                </tr>
              </thead>
              <tbody>
                {data.inKindSupports.map((s: any) => (
                  <tr key={s.id}>
                    <td>{new Date(s.supportDate).toLocaleDateString("ar-SA")}</td>
                    <td>{IN_KIND_CATEGORY_LABEL[s.category]}</td>
                    <td>{s.description}</td>
                    <td>{s.quantity}</td>
                    <td>{s.estimatedValue ? `${s.estimatedValue.toLocaleString("ar-SA")} ريال` : "-"}</td>
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

      {showCashForm && (
        <div className="modal-backdrop" onClick={() => setShowCashForm(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submitCash}>
            <h3>إضافة دعم نقدي</h3>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-grid">
              <div className="field">
                <label>المبلغ (ريال) *</label>
                <input required type="number" value={cashForm.amount} onChange={(e) => setCashForm({ ...cashForm, amount: e.target.value })} />
              </div>
              <div className="field">
                <label>نوع الدعم</label>
                <select value={cashForm.type} onChange={(e) => setCashForm({ ...cashForm, type: e.target.value })}>
                  <option value="MONTHLY">شهري</option>
                  <option value="EMERGENCY">طارئ</option>
                  <option value="SEASONAL">موسمي</option>
                  <option value="OTHER">أخرى</option>
                </select>
              </div>
              <div className="field">
                <label>تاريخ الصرف *</label>
                <input required type="date" value={cashForm.supportDate} onChange={(e) => setCashForm({ ...cashForm, supportDate: e.target.value })} />
              </div>
              <div className="field">
                <label>السنة *</label>
                <input required type="number" value={cashForm.year} onChange={(e) => setCashForm({ ...cashForm, year: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>ملاحظات</label>
                <textarea rows={2} value={cashForm.notes} onChange={(e) => setCashForm({ ...cashForm, notes: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowCashForm(false)}>
                إلغاء
              </button>
              <button type="submit" className="btn">
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}

      {showInKindForm && (
        <div className="modal-backdrop" onClick={() => setShowInKindForm(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submitInKind}>
            <h3>إضافة دعم عيني</h3>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-grid">
              <div className="field">
                <label>التصنيف</label>
                <select value={inKindForm.category} onChange={(e) => setInKindForm({ ...inKindForm, category: e.target.value })}>
                  <option value="FOOD">مواد غذائية</option>
                  <option value="CLOTHING">ملابس</option>
                  <option value="FURNITURE">أثاث</option>
                  <option value="DEVICES">أجهزة</option>
                  <option value="MEDICAL">مستلزمات طبية</option>
                  <option value="SCHOOL">مستلزمات مدرسية</option>
                  <option value="OTHER">أخرى</option>
                </select>
              </div>
              <div className="field">
                <label>الوصف *</label>
                <input required value={inKindForm.description} onChange={(e) => setInKindForm({ ...inKindForm, description: e.target.value })} />
              </div>
              <div className="field">
                <label>الكمية</label>
                <input type="number" value={inKindForm.quantity} onChange={(e) => setInKindForm({ ...inKindForm, quantity: e.target.value })} />
              </div>
              <div className="field">
                <label>القيمة التقديرية (ريال)</label>
                <input type="number" value={inKindForm.estimatedValue} onChange={(e) => setInKindForm({ ...inKindForm, estimatedValue: e.target.value })} />
              </div>
              <div className="field">
                <label>تاريخ التسليم *</label>
                <input required type="date" value={inKindForm.supportDate} onChange={(e) => setInKindForm({ ...inKindForm, supportDate: e.target.value })} />
              </div>
              <div className="field">
                <label>السنة *</label>
                <input required type="number" value={inKindForm.year} onChange={(e) => setInKindForm({ ...inKindForm, year: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowInKindForm(false)}>
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
