import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Summary {
  year: number;
  beneficiariesCount: number;
  activeCount: number;
  cashTotal: number;
  cashCount: number;
  inKindTotal: number;
  inKindCount: number;
  coursesCount: number;
  enrollmentsCount: number;
}

export default function Dashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/reports/summary")
      .then((res) => setSummary(res.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h2>لوحة التحكم</h2>
      </div>
      {loading && <p className="loading">جارٍ التحميل...</p>}
      {summary && (
        <div className="stat-grid">
          <div className="stat-card">
            <div className="value">{summary.beneficiariesCount}</div>
            <div className="label">إجمالي المستفيدين</div>
          </div>
          <div className="stat-card">
            <div className="value">{summary.activeCount}</div>
            <div className="label">مستفيدون نشطون</div>
          </div>
          <div className="stat-card">
            <div className="value">{summary.cashTotal.toLocaleString("ar-SA")} ريال</div>
            <div className="label">إجمالي الدعم النقدي ({summary.year})</div>
          </div>
          <div className="stat-card">
            <div className="value">{summary.cashCount}</div>
            <div className="label">عمليات دعم نقدي ({summary.year})</div>
          </div>
          <div className="stat-card">
            <div className="value">{summary.inKindTotal.toLocaleString("ar-SA")} ريال</div>
            <div className="label">القيمة التقديرية للدعم العيني ({summary.year})</div>
          </div>
          <div className="stat-card">
            <div className="value">{summary.inKindCount}</div>
            <div className="label">عمليات دعم عيني ({summary.year})</div>
          </div>
          <div className="stat-card">
            <div className="value">{summary.coursesCount}</div>
            <div className="label">الدورات التدريبية</div>
          </div>
          <div className="stat-card">
            <div className="value">{summary.enrollmentsCount}</div>
            <div className="label">تسجيلات في الدورات</div>
          </div>
        </div>
      )}
    </div>
  );
}
