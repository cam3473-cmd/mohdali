import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { SUPPORT_CATEGORY_LABEL, DISBURSEMENT_STATUS_LABEL, CASE_TYPE_LABEL } from "../lib/constants";

const ENROLLMENT_STATUS_LABEL: Record<string, string> = { ENROLLED: "مسجل", COMPLETED: "أكمل", DROPPED: "منسحب" };

export default function BeneficiaryDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<"supports" | "courses">("supports");
  const [loading, setLoading] = useState(true);

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
            <strong>رقم الملف:</strong> {data.fileNumber || "-"}
          </div>
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
            <strong>نوع الملف:</strong> {data.caseType ? CASE_TYPE_LABEL[data.caseType] : "-"}
          </div>
          <div>
            <strong>عدد أفراد الأسرة:</strong> {data.familyMembersCount ?? "-"}
          </div>
          <div>
            <strong>الآيبان:</strong> {data.iban || "-"}
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
            <Link to={`/campaigns?new=1&beneficiaryId=${id}`} className="btn small">
              + إضافة دعم
            </Link>
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
    </div>
  );
}
