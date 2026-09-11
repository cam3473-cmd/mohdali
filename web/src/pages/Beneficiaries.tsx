import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { CASE_TYPE_LABEL } from "../lib/constants";

interface Beneficiary {
  id: string;
  fileNumber?: string | null;
  nationalId: string;
  fullName: string;
  gender: "MALE" | "FEMALE";
  birthDate?: string | null;
  birthDateHijri?: string | null;
  maritalStatus?: string | null;
  caseType?: string | null;
  familyMembersCount?: number | null;
  monthlyIncome?: number | null;
  neighborhood?: string | null;
  address?: string | null;
  phone?: string | null;
  iban?: string | null;
  needCategory?: string | null;
  fileStatus: "ACTIVE" | "SUSPENDED" | "CLOSED";
  notes?: string | null;
}

const FILE_STATUS_LABEL: Record<string, string> = { ACTIVE: "نشط", SUSPENDED: "موقوف", CLOSED: "مغلق" };
const GENDER_LABEL: Record<string, string> = { MALE: "ذكر", FEMALE: "أنثى" };

const emptyForm = {
  fileNumber: "",
  nationalId: "",
  fullName: "",
  gender: "MALE",
  birthDate: "",
  birthDateHijri: "",
  maritalStatus: "",
  caseType: "",
  familyMembersCount: "",
  monthlyIncome: "",
  neighborhood: "",
  address: "",
  phone: "",
  iban: "",
  needCategory: "",
  fileStatus: "ACTIVE",
  notes: "",
};

export default function Beneficiaries() {
  const [items, setItems] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [error, setError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    insertedCount: number;
    skippedDuplicates: { row: number; nationalId: string }[];
    errors: { row: number; message: string }[];
  } | null>(null);
  const [importError, setImportError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/beneficiaries", { params: { q: q || undefined, status: status || undefined } });
      setItems(res.data.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status]);

  function openAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setError("");
    setShowForm(true);
  }

  function openEdit(b: Beneficiary) {
    setForm({
      fileNumber: b.fileNumber ?? "",
      nationalId: b.nationalId,
      fullName: b.fullName,
      gender: b.gender,
      birthDate: b.birthDate ? b.birthDate.slice(0, 10) : "",
      birthDateHijri: b.birthDateHijri ?? "",
      maritalStatus: b.maritalStatus ?? "",
      caseType: b.caseType ?? "",
      familyMembersCount: b.familyMembersCount?.toString() ?? "",
      monthlyIncome: b.monthlyIncome?.toString() ?? "",
      neighborhood: b.neighborhood ?? "",
      address: b.address ?? "",
      phone: b.phone ?? "",
      iban: b.iban ?? "",
      needCategory: b.needCategory ?? "",
      fileStatus: b.fileStatus,
      notes: b.notes ?? "",
    });
    setEditingId(b.id);
    setError("");
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const payload = {
      fileNumber: form.fileNumber || null,
      nationalId: form.nationalId,
      fullName: form.fullName,
      gender: form.gender,
      birthDate: form.birthDate ? new Date(form.birthDate).toISOString() : null,
      birthDateHijri: form.birthDateHijri || null,
      maritalStatus: form.maritalStatus || null,
      caseType: form.caseType || null,
      familyMembersCount: form.familyMembersCount ? Number(form.familyMembersCount) : null,
      monthlyIncome: form.monthlyIncome ? Number(form.monthlyIncome) : null,
      neighborhood: form.neighborhood || null,
      address: form.address || null,
      phone: form.phone || null,
      iban: form.iban || null,
      needCategory: form.needCategory || null,
      fileStatus: form.fileStatus,
      notes: form.notes || null,
    };
    try {
      if (editingId) {
        await api.put(`/beneficiaries/${editingId}`, payload);
      } else {
        await api.post("/beneficiaries", payload);
      }
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("هل تريد حذف بيانات هذا المستفيد نهائياً؟ سيتم حذف جميع سجلات الدعم المرتبطة به.")) return;
    await api.delete(`/beneficiaries/${id}`);
    load();
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
      const res = await api.post("/beneficiaries/import", formData, {
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

  return (
    <div>
      <div className="page-header">
        <h2>المستفيدون</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input ref={fileInputRef} type="file" accept=".xlsx" hidden onChange={handleFileSelected} />
          <button className="btn secondary" onClick={openImportPicker} disabled={importing}>
            {importing ? "جارٍ الاستيراد..." : "استيراد من إكسل"}
          </button>
          <button className="btn" onClick={openAdd}>
            + إضافة مستفيد
          </button>
        </div>
      </div>

      {importError && <div className="error-banner">{importError}</div>}

      <div className="toolbar">
        <input placeholder="بحث بالاسم أو رقم الهوية أو الجوال أو رقم الملف..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="ACTIVE">نشط</option>
          <option value="SUSPENDED">موقوف</option>
          <option value="CLOSED">مغلق</option>
        </select>
      </div>

      <div className="card">
        {loading ? (
          <p className="loading">جارٍ التحميل...</p>
        ) : items.length === 0 ? (
          <p className="empty-state">لا يوجد مستفيدون مطابقون</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>رقم الملف</th>
                <th>الاسم</th>
                <th>رقم الهوية</th>
                <th>الجنس</th>
                <th>نوع الملف</th>
                <th>الحي</th>
                <th>الجوال</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id}>
                  <td>{b.fileNumber || "-"}</td>
                  <td>
                    <Link to={`/beneficiaries/${b.id}`}>{b.fullName}</Link>
                  </td>
                  <td>{b.nationalId}</td>
                  <td>{GENDER_LABEL[b.gender]}</td>
                  <td>{b.caseType ? CASE_TYPE_LABEL[b.caseType] : "-"}</td>
                  <td>{b.neighborhood || "-"}</td>
                  <td>{b.phone || "-"}</td>
                  <td>
                    <span className={`badge ${b.fileStatus.toLowerCase()}`}>{FILE_STATUS_LABEL[b.fileStatus]}</span>
                  </td>
                  <td>
                    <button className="btn secondary small" onClick={() => openEdit(b)}>
                      تعديل
                    </button>{" "}
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
            <h3>{editingId ? "تعديل بيانات مستفيد" : "إضافة مستفيد جديد"}</h3>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-grid">
              <div className="field">
                <label>رقم الملف</label>
                <input value={form.fileNumber} onChange={(e) => setForm({ ...form, fileNumber: e.target.value })} />
              </div>
              <div className="field">
                <label>رقم الهوية *</label>
                <input
                  required
                  value={form.nationalId}
                  onChange={(e) => setForm({ ...form, nationalId: e.target.value })}
                />
              </div>
              <div className="field">
                <label>الاسم الكامل *</label>
                <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </div>
              <div className="field">
                <label>الجنس</label>
                <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option value="MALE">ذكر</option>
                  <option value="FEMALE">أنثى</option>
                </select>
              </div>
              <div className="field">
                <label>تاريخ الميلاد</label>
                <input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} />
              </div>
              <div className="field">
                <label>تاريخ الميلاد الهجري</label>
                <input value={form.birthDateHijri} onChange={(e) => setForm({ ...form, birthDateHijri: e.target.value })} placeholder="مثال: 1440/05/12" />
              </div>
              <div className="field">
                <label>نوع الملف</label>
                <select value={form.caseType} onChange={(e) => setForm({ ...form, caseType: e.target.value })}>
                  <option value="">غير محدد</option>
                  <option value="INDIVIDUAL">فرد</option>
                  <option value="FAMILY">أسرة</option>
                </select>
              </div>
              <div className="field">
                <label>الحالة الاجتماعية</label>
                <select value={form.maritalStatus} onChange={(e) => setForm({ ...form, maritalStatus: e.target.value })}>
                  <option value="">غير محدد</option>
                  <option value="SINGLE">أعزب</option>
                  <option value="MARRIED">متزوج</option>
                  <option value="DIVORCED">مطلق</option>
                  <option value="WIDOWED">أرمل</option>
                </select>
              </div>
              <div className="field">
                <label>عدد أفراد الأسرة</label>
                <input
                  type="number"
                  value={form.familyMembersCount}
                  onChange={(e) => setForm({ ...form, familyMembersCount: e.target.value })}
                />
              </div>
              <div className="field">
                <label>الدخل الشهري (ريال)</label>
                <input
                  type="number"
                  value={form.monthlyIncome}
                  onChange={(e) => setForm({ ...form, monthlyIncome: e.target.value })}
                />
              </div>
              <div className="field">
                <label>الحي</label>
                <input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />
              </div>
              <div className="field">
                <label>رقم الجوال</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="field">
                <label>الآيبان</label>
                <input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="SA..." />
              </div>
              <div className="field">
                <label>تصنيف الاحتياج</label>
                <input value={form.needCategory} onChange={(e) => setForm({ ...form, needCategory: e.target.value })} />
              </div>
              <div className="field">
                <label>حالة الملف</label>
                <select value={form.fileStatus} onChange={(e) => setForm({ ...form, fileStatus: e.target.value })}>
                  <option value="ACTIVE">نشط</option>
                  <option value="SUSPENDED">موقوف</option>
                  <option value="CLOSED">مغلق</option>
                </select>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>العنوان التفصيلي</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>ملاحظات</label>
                <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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

      {importResult && (
        <div className="modal-backdrop" onClick={() => setImportResult(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>نتيجة الاستيراد</h3>
            <p>
              تمت إضافة <strong>{importResult.insertedCount}</strong> مستفيد جديد.
              {importResult.skippedDuplicates.length > 0 && (
                <> تم تجاوز <strong>{importResult.skippedDuplicates.length}</strong> صف لوجود رقم هوية مكرر مسبقاً.</>
              )}
            </p>
            {importResult.errors.length > 0 && (
              <>
                <p style={{ color: "var(--danger)", fontWeight: 600 }}>صفوف بها أخطاء ({importResult.errors.length}):</p>
                <table>
                  <thead>
                    <tr>
                      <th>رقم الصف</th>
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
              </>
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
