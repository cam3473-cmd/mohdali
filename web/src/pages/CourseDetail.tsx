import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import BeneficiaryPicker from "../components/BeneficiaryPicker";
import NumericInput from "../components/NumericInput";

const STATUS_LABEL: Record<string, string> = { ENROLLED: "مسجل", COMPLETED: "أكمل", DROPPED: "منسحب" };
const CATEGORY_LABEL: Record<string, string> = {
  COMPUTER: "حاسب آلي",
  LANGUAGES: "لغات",
  AI: "ذكاء اصطناعي",
  LIFE_SKILLS: "مهارات حياتية",
  OTHER: "أخرى",
};

const emptyForm = {
  fullName: "",
  civilId: "",
  phone: "",
  birthDate: "",
  birthDateHijri: "",
  email: "",
};

function editCourseFormFrom(c: any) {
  return {
    title: c.title,
    category: c.category,
    trainer: c.trainer ?? "",
    startDate: c.startDate.slice(0, 10),
    endDate: c.endDate ? c.endDate.slice(0, 10) : "",
    seatsCount: c.seatsCount != null ? String(c.seatsCount) : "",
    location: c.location ?? "",
    totalCost: c.totalCost != null ? String(c.totalCost) : "",
    notes: c.notes ?? "",
  };
}

export default function CourseDetail() {
  const { id } = useParams();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [linkBeneficiary, setLinkBeneficiary] = useState(false);
  const [beneficiary, setBeneficiary] = useState<{ id: string; fullName: string } | null>(null);
  const [error, setError] = useState("");

  const [showEditCourse, setShowEditCourse] = useState(false);
  const [editCourseForm, setEditCourseForm] = useState<ReturnType<typeof editCourseFormFrom> | null>(null);
  const [editCourseError, setEditCourseError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<{ insertedCount: number; errors: { row: number; message: string }[] } | null>(null);

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

  function openEditCourse() {
    setEditCourseForm(editCourseFormFrom(course));
    setEditCourseError("");
    setShowEditCourse(true);
  }

  async function handleEditCourseSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editCourseForm) return;
    setEditCourseError("");
    try {
      await api.put(`/courses/${id}`, {
        title: editCourseForm.title,
        category: editCourseForm.category,
        trainer: editCourseForm.trainer || null,
        startDate: new Date(editCourseForm.startDate).toISOString(),
        endDate: editCourseForm.endDate ? new Date(editCourseForm.endDate).toISOString() : null,
        seatsCount: editCourseForm.seatsCount ? Number(editCourseForm.seatsCount) : null,
        location: editCourseForm.location || null,
        totalCost: editCourseForm.totalCost ? Number(editCourseForm.totalCost) : null,
        notes: editCourseForm.notes || null,
      });
      setShowEditCourse(false);
      load();
    } catch (err) {
      setEditCourseError(apiErrorMessage(err));
    }
  }

  function openImportPicker() {
    setImportError("");
    setImportResult(null);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImporting(true);
    setImportError("");
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await api.post(`/courses/${id}/participants/import`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setImportResult(res.data);
      load();
    } catch (err) {
      setImportError(apiErrorMessage(err));
    } finally {
      setImporting(false);
    }
  }

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
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn secondary" onClick={openEditCourse}>
            تعديل الدورة
          </button>
          <Link to="/courses" className="btn secondary">
            رجوع إلى الدورات
          </Link>
        </div>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <h3 style={{ marginTop: 0, fontSize: 15 }}>إضافة مشارك جديد</h3>
          <div>
            <input ref={fileInputRef} type="file" accept=".xlsx" hidden onChange={handleFileSelected} />
            <button type="button" className="btn secondary small" onClick={openImportPicker} disabled={importing}>
              {importing ? "جارٍ الاستيراد..." : "استيراد من إكسل"}
            </button>
          </div>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: -6 }}>
          لا يشترط أن يكون المشارك مستفيداً مسجَّلاً — أدخل بياناته مباشرة (قد يكون ابناً أو بنتاً لمستفيد، أو من فئة أخرى).
          يمكن أيضاً استيراد عدة مشاركين دفعة واحدة من ملف إكسل يحتوي عمود "الاسم" على الأقل.
        </p>
        {importError && <div className="error-banner">{importError}</div>}
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

      {showEditCourse && editCourseForm && (
        <div className="modal-backdrop" onClick={() => setShowEditCourse(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleEditCourseSubmit}>
            <h3>تعديل الدورة</h3>
            {editCourseError && <div className="error-banner">{editCourseError}</div>}
            <div className="form-grid">
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>اسم الدورة *</label>
                <input
                  required
                  value={editCourseForm.title}
                  onChange={(e) => setEditCourseForm({ ...editCourseForm, title: e.target.value })}
                />
              </div>
              <div className="field">
                <label>الفئة</label>
                <select
                  value={editCourseForm.category}
                  onChange={(e) => setEditCourseForm({ ...editCourseForm, category: e.target.value })}
                >
                  {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>المدرب</label>
                <input
                  value={editCourseForm.trainer}
                  onChange={(e) => setEditCourseForm({ ...editCourseForm, trainer: e.target.value })}
                />
              </div>
              <div className="field">
                <label>تاريخ البدء *</label>
                <input
                  required
                  type="date"
                  value={editCourseForm.startDate}
                  onChange={(e) => setEditCourseForm({ ...editCourseForm, startDate: e.target.value })}
                />
              </div>
              <div className="field">
                <label>تاريخ الانتهاء</label>
                <input
                  type="date"
                  value={editCourseForm.endDate}
                  onChange={(e) => setEditCourseForm({ ...editCourseForm, endDate: e.target.value })}
                />
              </div>
              <div className="field">
                <label>عدد المقاعد</label>
                <NumericInput
                  value={editCourseForm.seatsCount}
                  onChange={(v) => setEditCourseForm({ ...editCourseForm, seatsCount: v })}
                />
              </div>
              <div className="field">
                <label>مكان الانعقاد</label>
                <input
                  value={editCourseForm.location}
                  onChange={(e) => setEditCourseForm({ ...editCourseForm, location: e.target.value })}
                />
              </div>
              <div className="field">
                <label>التكلفة الإجمالية (ريال)</label>
                <NumericInput
                  value={editCourseForm.totalCost}
                  onChange={(v) => setEditCourseForm({ ...editCourseForm, totalCost: v })}
                />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>ملاحظات</label>
                <textarea
                  rows={2}
                  value={editCourseForm.notes}
                  onChange={(e) => setEditCourseForm({ ...editCourseForm, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowEditCourse(false)}>
                إلغاء
              </button>
              <button type="submit" className="btn">
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}

      {importResult && (
        <div className="modal-backdrop" onClick={() => setImportResult(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>نتيجة الاستيراد</h3>
            <p>
              تمت إضافة <strong>{importResult.insertedCount}</strong> مشارك جديد.
            </p>
            {importResult.errors.length > 0 && (
              <div>
                <p style={{ color: "var(--danger)", fontWeight: 600 }}>صفوف بها أخطاء ({importResult.errors.length}):</p>
                <div style={{ maxHeight: 200, overflowY: "auto", fontSize: 13 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>الصف</th>
                        <th>الخطأ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.errors.map((e, i) => (
                        <tr key={i}>
                          <td>{e.row}</td>
                          <td>{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setImportResult(null)}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
