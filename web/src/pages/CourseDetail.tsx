import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import BeneficiaryPicker from "../components/BeneficiaryPicker";

const STATUS_LABEL: Record<string, string> = { ENROLLED: "مسجل", COMPLETED: "أكمل", DROPPED: "منسحب" };

export default function CourseDetail() {
  const { id } = useParams();
  const [course, setCourse] = useState<any>(null);
  const [loading, setLoading] = useState(true);
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

  async function enroll() {
    if (!beneficiary) return;
    setError("");
    try {
      await api.post(`/courses/${id}/enrollments`, { beneficiaryId: beneficiary.id });
      setBeneficiary(null);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function updateStatus(enrollmentId: string, status: string) {
    await api.put(`/courses/enrollments/${enrollmentId}`, { status });
    load();
  }

  async function toggleCertificate(enrollmentId: string, current: boolean) {
    await api.put(`/courses/enrollments/${enrollmentId}`, { certificateIssued: !current });
    load();
  }

  async function removeEnrollment(enrollmentId: string) {
    if (!confirm("هل تريد إزالة هذا المستفيد من الدورة؟")) return;
    await api.delete(`/courses/enrollments/${enrollmentId}`);
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
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>تسجيل مستفيد جديد</h3>
        {error && <div className="error-banner">{error}</div>}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <BeneficiaryPicker value={beneficiary} onChange={setBeneficiary} />
          </div>
          <button className="btn" onClick={enroll} disabled={!beneficiary}>
            تسجيل
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>المستفيدون المسجلون ({course.enrollments.length})</h3>
        {course.enrollments.length === 0 ? (
          <p className="empty-state">لا يوجد مستفيدون مسجلون بعد</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>رقم الهوية</th>
                <th>الحالة</th>
                <th>الشهادة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {course.enrollments.map((e: any) => (
                <tr key={e.id}>
                  <td>{e.beneficiary.fullName}</td>
                  <td>{e.beneficiary.nationalId}</td>
                  <td>
                    <select value={e.status} onChange={(ev) => updateStatus(e.id, ev.target.value)}>
                      {Object.entries(STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="btn secondary small" onClick={() => toggleCertificate(e.id, e.certificateIssued)}>
                      {e.certificateIssued ? "صدرت ✓" : "لم تصدر"}
                    </button>
                  </td>
                  <td>
                    <button className="btn danger small" onClick={() => removeEnrollment(e.id)}>
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
