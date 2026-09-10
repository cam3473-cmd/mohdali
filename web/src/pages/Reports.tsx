import { useState } from "react";
import { downloadReport } from "../lib/api";
import { SUPPORT_CATEGORY_LABEL } from "../lib/constants";

const currentYear = new Date().getFullYear();

export default function Reports() {
  const [year, setYear] = useState(String(currentYear));
  const [category, setCategory] = useState("");

  return (
    <div>
      <div className="page-header">
        <h2>التقارير</h2>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>التقرير السنوي الشامل</h3>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          تقرير موحّد يشمل ملخص المستفيدين وجميع أنواع الدعم لسنة محددة — مناسب للرفع لصندوق دعم الجمعيات والمركز
          الوطني لتنمية القطاع غير الربحي ومنصة إحسان.
        </p>
        <div className="toolbar">
          <label>السنة:</label>
          <input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 100 }} />
          <button
            className="btn"
            onClick={() => downloadReport(`/reports/annual-summary.xlsx?year=${year}`, `التقرير_السنوي_الشامل_${year}.xlsx`)}
          >
            تحميل التقرير السنوي
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>تقرير الدعوم ({year})</h3>
        <div className="toolbar">
          <label>النوع:</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">كل الأنواع</option>
            {Object.entries(SUPPORT_CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button
            className="btn secondary"
            onClick={() =>
              downloadReport(
                `/reports/supports.xlsx?year=${year}${category ? `&category=${category}` : ""}`,
                `تقرير_الدعوم_${year}.xlsx`
              )
            }
          >
            تحميل
          </button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>تقرير المستفيدين</h3>
          <button className="btn secondary" onClick={() => downloadReport("/reports/beneficiaries.xlsx", "تقرير_المستفيدين.xlsx")}>
            تحميل
          </button>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: 15 }}>تقرير الدورات التدريبية</h3>
          <button className="btn secondary" onClick={() => downloadReport("/reports/courses.xlsx", "تقرير_الدورات_التدريبية.xlsx")}>
            تحميل
          </button>
        </div>
      </div>
    </div>
  );
}
