import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { SUPPORT_CATEGORY_LABEL } from "../lib/constants";

interface CategoryBreakdown {
  category: string;
  categoryLabel: string;
  total: number;
  count: number;
}

// روابط أنظمة خارجية تُستخدم من الجمعية
const EXTERNAL_LINKS = [
  { label: "نظام غيث", url: "https://new.ghaith.io/ar" },
  { label: "نظام رسائل المستفيدين", url: "https://portal.oursms.com/dashboard" },
  { label: "نظام الامتياز المحاسبي", url: "https://char2.emt-cloud.com/FIN/ACCSTM?f=1" },
];

// تُفتح كنافذة منبثقة مصغّرة بدون شريط عنوان/تبويبات المتصفح، بدل تبويب كامل جديد
function openExternal(url: string) {
  window.open(
    url,
    "_blank",
    "width=1200,height=840,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes"
  );
}

interface Summary {
  year: number;
  beneficiariesCount: number;
  activeCount: number;
  supportTotal: number;
  supportCount: number;
  byCategory: CategoryBreakdown[];
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

      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>أنظمة خارجية:</span>
        {EXTERNAL_LINKS.map((link) => (
          <button key={link.url} type="button" className="btn secondary small" onClick={() => openExternal(link.url)}>
            {link.label}
          </button>
        ))}
      </div>

      {loading && <p className="loading">جارٍ التحميل...</p>}
      {summary && (
        <>
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
              <div className="value">{summary.supportTotal.toLocaleString("ar-SA")} ريال</div>
              <div className="label">إجمالي الدعم المصروف ({summary.year})</div>
            </div>
            <div className="stat-card">
              <div className="value">{summary.supportCount}</div>
              <div className="label">عمليات دعم مصروفة ({summary.year})</div>
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

          {summary.byCategory.length > 0 && (
            <div className="card">
              <h3 style={{ marginTop: 0, fontSize: 15 }}>الدعم حسب النوع ({summary.year})</h3>
              <table>
                <thead>
                  <tr>
                    <th>النوع</th>
                    <th>عدد العمليات</th>
                    <th>الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byCategory.map((c) => (
                    <tr key={c.category}>
                      <td>{SUPPORT_CATEGORY_LABEL[c.category] ?? c.categoryLabel}</td>
                      <td>{c.count}</td>
                      <td>{c.total.toLocaleString("ar-SA")} ريال</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
