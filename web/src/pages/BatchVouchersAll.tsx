import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import DisbursementVoucherBody from "../components/DisbursementVoucherBody";

export default function BatchVouchersAll() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [batch, setBatch] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/batches/${id}`)
      .then((res) => setBatch(res.data))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="loading">جارٍ التحميل...</p>;
  if (!batch) return <p className="empty-state">الدفعة غير موجودة</p>;

  // ترتيب أبجدي بأسماء المستفيدين عند الطباعة الجماعية
  const supports = [...batch.supports].sort((a: any, b: any) =>
    a.beneficiary.fullName.localeCompare(b.beneficiary.fullName, "ar")
  );

  return (
    <div style={{ background: "#f5f7f6", minHeight: "100vh", padding: 24 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .voucher-page { page-break-after: always; }
          .voucher-page:last-child { page-break-after: auto; }
        }
        .voucher-page { padding-top: 24px; }
      `}</style>

      <div className="no-print" style={{ maxWidth: 700, margin: "0 auto 16px", display: "flex", justifyContent: "space-between" }}>
        <button className="btn secondary" onClick={() => navigate(-1)}>
          رجوع
        </button>
        <div>
          <h2 style={{ margin: 0 }}>سندات صرف الدفعة: {batch.title}</h2>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            {supports.length} سند، مرتّبة أبجدياً بأسماء المستفيدين
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to="/" className="btn secondary">
            الصفحة الرئيسية
          </Link>
          <button className="btn" onClick={() => window.print()} disabled={supports.length === 0}>
            طباعة الكل
          </button>
        </div>
      </div>

      {supports.length === 0 ? (
        <p className="empty-state">لا توجد سندات صرف لهذه الدفعة بعد</p>
      ) : (
        supports.map((s: any) => (
          <div key={s.id} className="voucher-page">
            <DisbursementVoucherBody support={{ ...s, batch: { title: batch.title } }} />
          </div>
        ))
      )}
    </div>
  );
}
