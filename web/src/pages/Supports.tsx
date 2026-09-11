import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, downloadReport } from "../lib/api";
import { SUPPORT_CATEGORY_LABEL, DISBURSEMENT_STATUS_LABEL } from "../lib/constants";

const currentYear = new Date().getFullYear();

export default function Supports() {
  const [items, setItems] = useState<any[]>([]);
  const [year, setYear] = useState(String(currentYear));
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);

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

  const total = items.filter((s) => s.status === "DISBURSED").reduce((sum, s) => sum + (s.amount ?? 0), 0);

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
          <Link to="/campaigns?new=1" className="btn">
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
        <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 100 }} />
        <label>النوع:</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">كل الأنواع</option>
          {Object.entries(SUPPORT_CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span style={{ marginRight: "auto", color: "var(--muted)" }}>
          إجمالي المصروف: <strong>{total.toLocaleString("ar-SA")} ريال</strong>
        </span>
      </div>

      <div className="card">
        {loading ? (
          <p className="loading">جارٍ التحميل...</p>
        ) : items.length === 0 ? (
          <p className="empty-state">لا توجد سجلات دعم</p>
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
                  <td>
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
    </div>
  );
}
