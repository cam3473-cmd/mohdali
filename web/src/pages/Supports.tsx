import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, apiErrorMessage, downloadReport } from "../lib/api";
import { SUPPORT_CATEGORY_LABEL, DISBURSEMENT_STATUS_LABEL } from "../lib/constants";
import NumericInput from "../components/NumericInput";

const currentYear = new Date().getFullYear();

function editFormFrom(s: any) {
  return {
    category: s.category,
    amount: s.amount != null ? String(s.amount) : "",
    description: s.description ?? "",
    quantity: s.quantity != null ? String(s.quantity) : "",
    status: s.status,
    supportDate: s.supportDate.slice(0, 10),
    notes: s.notes ?? "",
  };
}

export default function Supports() {
  const [items, setItems] = useState<any[]>([]);
  const [year, setYear] = useState(String(currentYear));
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ReturnType<typeof editFormFrom> | null>(null);
  const [editError, setEditError] = useState("");
  const [groupByBeneficiary, setGroupByBeneficiary] = useState(false);

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

  async function handleDelete(id: string) {
    if (!confirm("هل تريد حذف سجل الدعم هذا؟")) return;
    await api.delete(`/supports/${id}`);
    load();
  }

  function openEdit(s: any) {
    setEditingId(s.id);
    setEditForm(editFormFrom(s));
    setEditError("");
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editForm || !editingId) return;
    setEditError("");
    try {
      await api.put(`/supports/${editingId}`, {
        category: editForm.category,
        amount: editForm.amount ? Number(editForm.amount) : null,
        description: editForm.description || null,
        quantity: editForm.quantity ? Number(editForm.quantity) : null,
        status: editForm.status,
        supportDate: new Date(editForm.supportDate).toISOString(),
        notes: editForm.notes || null,
      });
      setEditingId(null);
      setEditForm(null);
      load();
    } catch (err) {
      setEditError(apiErrorMessage(err));
    }
  }

  const total = items.filter((s) => s.status === "DISBURSED").reduce((sum, s) => sum + (s.amount ?? 0), 0);

  // تجميع سجلات الدعم حسب المستفيد لإظهار إجمالي ما استلمه كل شخص (حتى لو صُرف له أكثر من مرة)
  // بدل الاكتفاء بعرض كل عملية صرف كسطر منفصل
  const grouped = (() => {
    const map = new Map<
      string,
      { beneficiaryId: string; fullName: string; count: number; totalAmount: number; lastDate: string }
    >();
    for (const s of items) {
      const amount = s.status === "DISBURSED" ? s.amount ?? 0 : 0;
      const existing = map.get(s.beneficiaryId);
      if (existing) {
        existing.count += 1;
        existing.totalAmount += amount;
        if (s.supportDate > existing.lastDate) existing.lastDate = s.supportDate;
      } else {
        map.set(s.beneficiaryId, {
          beneficiaryId: s.beneficiaryId,
          fullName: s.beneficiary.fullName,
          count: 1,
          totalAmount: amount,
          lastDate: s.supportDate,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.fullName.localeCompare(b.fullName, "ar"));
  })();

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
          <Link to="/batches?new=1" className="btn">
            + إضافة دعم
          </Link>
        </div>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 14, marginTop: -10 }}>
        كل عملية صرف تتم عبر دفعة دعم — تحدّد النوع مرة واحدة ثم تختار من يشملهم الصرف (مستفيد واحد أو أكثر) بمبلغ
        قابل للتعديل لكل مستفيد.
      </p>

      <div className="toolbar">
        <label>السنة:</label>
        <NumericInput value={year} onChange={setYear} style={{ width: 100 }} />
        <label>النوع:</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">كل الأنواع</option>
          {Object.entries(SUPPORT_CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 4, marginRight: "auto" }}>
          <button
            className={`btn ${groupByBeneficiary ? "secondary" : ""} small`}
            onClick={() => setGroupByBeneficiary(false)}
          >
            تفصيلي (كل عملية صرف)
          </button>
          <button
            className={`btn ${groupByBeneficiary ? "" : "secondary"} small`}
            onClick={() => setGroupByBeneficiary(true)}
          >
            إجمالي لكل مستفيد
          </button>
        </div>
        <span style={{ color: "var(--muted)" }}>
          إجمالي المصروف: <strong>{total.toLocaleString("ar-SA")} ريال</strong>
        </span>
      </div>

      <div className="card">
        {loading ? (
          <p className="loading">جارٍ التحميل...</p>
        ) : items.length === 0 ? (
          <p className="empty-state">لا توجد سجلات دعم</p>
        ) : groupByBeneficiary ? (
          <table>
            <thead>
              <tr>
                <th>المستفيد</th>
                <th>عدد مرات الصرف</th>
                <th>إجمالي المصروف</th>
                <th>آخر تاريخ صرف</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <tr key={g.beneficiaryId}>
                  <td>{g.fullName}</td>
                  <td>
                    {g.count}
                    {g.count > 1 && (
                      <span style={{ marginRight: 6, fontSize: 12, color: "var(--danger, #c0392b)" }}>
                        (صُرف له أكثر من مرة)
                      </span>
                    )}
                  </td>
                  <td>{g.totalAmount.toLocaleString("ar-SA")} ريال</td>
                  <td>{new Date(g.lastDate).toLocaleDateString("ar-SA")}</td>
                  <td>
                    <Link to={`/beneficiaries/${g.beneficiaryId}`} className="btn secondary small">
                      تفاصيل المستفيد
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  <td style={{ display: "flex", gap: 6 }}>
                    <Link to={`/supports/${s.id}/voucher`} className="btn secondary small">
                      سند صرف
                    </Link>
                    <button className="btn secondary small" onClick={() => openEdit(s)}>
                      تعديل
                    </button>
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

      {editForm && (
        <div className="modal-backdrop" onClick={() => setEditingId(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleEditSubmit}>
            <h3>تعديل سجل دعم</h3>
            {editError && <div className="error-banner">{editError}</div>}
            <div className="form-grid">
              <div className="field">
                <label>نوع الدعم</label>
                <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}>
                  {Object.entries(SUPPORT_CATEGORY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>الحالة</label>
                <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                  {Object.entries(DISBURSEMENT_STATUS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>المبلغ (ريال)</label>
                <NumericInput value={editForm.amount} onChange={(v) => setEditForm({ ...editForm, amount: v })} />
              </div>
              <div className="field">
                <label>الكمية (للعيني)</label>
                <NumericInput value={editForm.quantity} onChange={(v) => setEditForm({ ...editForm, quantity: v })} />
              </div>
              <div className="field">
                <label>تاريخ الصرف *</label>
                <input required type="date" value={editForm.supportDate} onChange={(e) => setEditForm({ ...editForm, supportDate: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>الوصف</label>
                <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>ملاحظات</label>
                <textarea rows={2} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setEditingId(null)}>
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
