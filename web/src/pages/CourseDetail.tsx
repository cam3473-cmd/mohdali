import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import BeneficiaryPicker from "../components/BeneficiaryPicker";

const STATUS_LABEL: Record<string, string> = { ENROLLED: "مسجل", COMPLETED: "أكمل", DROPPED: "منسحب" };

const emptyForm = {
  fullName: "",
  civilId: "",
  phone: "",
  birthDate: "",
  birthDateHijri: "",
  email: "",
};

export default function CourseDetail() {
  const { id } = useParams();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [linkBeneficiary, setLinkBeneficiary] = useState(false);
  const [beneficiary, setBeneficiary] = useState<{ id: string; fullName: string } | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/courses/${id}`);
      setCourse(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function addParticipant(e: FormEvent) {
    e.preventDefault();
    if (!form.fullName.trim()) return;
    setError("");
    try {
      await api.post(`/courses/${id}/participants`, {
        fullName: form.fullName,
        civilId: form.civilId || null,
        phone: form.phone || null,
        birthDate: form.birthDate ? new Date(form.birthDate).toISOString() : null,
        birthDateHijri: form.birthDateHijri || null,
        email: form.email || null,
        beneficiaryId: linkBeneficiary ? beneficiary?.id || null : null,
      });
      setForm(emptyForm);
      setBeneficiary(null);
      setLinkBeneficiary(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function updateStatus(participantId: string, status: string) {
    await api.put(`/courses/participants/${participantId}`, { status });
    load();
  }

  async function toggleCertificate(participantId: string, current: boolean) {
    await api.put(`/courses/participants/${participantId}`, { certificateIssued: !current });
    load();
  }

  async function removeParticipant(participantId: string) {
    if (!confirm("هل تريد إزالة هذا المشارك من الدورة؟")) return;
    await api.delete(`/courses/participants/${participantId}`);
    load();
  }

  if (loading || !course) return <p className="loading">جارٍ التحميل...</p>;

  return (
    <div>
      <div className="page-header">
        <h2>{course.title}</h2>
        <Link to="/courses" className="btn secondary">
          رجوع إلى الدورات
        </Link>
      </div>

      <div className="card">
        <div className="form-grid">
          <div>
            <strong>المدرب:</strong> {course.trainer || "-"}
          </div>
          <div>
            <strong>تاريخ البدء:</strong> {new Date(course.startDate).toLocaleDateString("ar-SA")}
          </div>
          <div>
            <strong>عدد المقاعد:</strong> {course.seatsCount ?? "-"}
          </div>
          <div>
            <strong>المكان:</strong> {course.location || "-"}
          </div>
          <div>
            <strong>التكلفة الإجمالية:</strong> {course.totalCost != null ? `${course.totalCost.toLocaleString("ar-SA")} ريال` : "-"}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>إضافة مشارك جديد</h3>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -6 }}>
          لا يشترط أن يكون المشارك مستفيداً مسجَّلاً — أدخل بياناته مباشرة (قد يكون ابناً أو بنتاً لمستفيد، أو من فئة أخرى).
        </p>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={addParticipant}>
          <div className="form-grid">
            <div className="field">
              <label>الاسم *</label>
              <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div className="field">
              <label>السجل المدني / الهوية</label>
              <input value={form.civilId} onChange={(e) => setForm({ ...form, civilId: e.target.value })} />
            </div>
            <div className="field">
              <label>الجوال</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="field">
              <label>البريد الإلكتروني</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="field">
              <label>تاريخ الميلاد الميلادي</label>
              <input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
            </div>
            <div className="field">
              <label>تاريخ الميلاد الهجري</label>
              <input value={form.birthDateHijri} onChange={(e) => setForm({ ...form, birthDateHijri: e.target.value })} placeholder="مثال: ١٤٤٠/٠٥/١٢" />
            </div>
          </div>

          <div style={{ margin: "10px 0" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={linkBeneficiary} onChange={(e) => setLinkBeneficiary(e.target.checked)} />
              ربط اختياري بمستفيد مسجَّل (للإحالة فقط)
            </label>
            {linkBeneficiary && (
              <div style={{ maxWidth: 360, marginTop: 8 }}>
                <BeneficiaryPicker value={beneficiary} onChange={setBeneficiary} />
              </div>
            )}
          </div>

          <button type="submit" className="btn">
            إضافة المشارك
          </button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>المشاركون ({course.participants.length})</h3>
        {course.participants.length === 0 ? (
          <p className="empty-state">لا يوجد مشاركون مسجلون بعد</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>السجل المدني</th>
                <th>الجوال</th>
                <th>مستفيد مرتبط</th>
                <th>الحالة</th>
                <th>الشهادة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {course.participants.map((p: any) => (
                <tr key={p.id}>
                  <td>{p.fullName}</td>
                  <td>{p.civilId || "-"}</td>
                  <td>{p.phone || "-"}</td>
                  <td>{p.beneficiary?.fullName || "-"}</td>
                  <td>
                    <select value={p.status} onChange={(ev) => updateStatus(p.id, ev.target.value)}>
                      {Object.entries(STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="btn secondary small" onClick={() => toggleCertificate(p.id, p.certificateIssued)}>
                      {p.certificateIssued ? "صدرت ✓" : "لم تصدر"}
                    </button>
                  </td>
                  <td>
                    <button className="btn danger small" onClick={() => removeParticipant(p.id)}>
                      إزالة
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
