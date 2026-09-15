import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import DisbursementVoucherBody from "../components/DisbursementVoucherBody";

export default function SupportVoucher() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [support, setSupport] = useState<any>(null);

  useEffect(() => {
    api.get(`/supports/${id}`).then((res) => setSupport(res.data));
  }, [id]);

  if (!support) return <p className="loading">جارٍ التحميل...</p>;

  return (
    <div style={{ background: "#f5f7f6", minHeight: "100vh", padding: 24 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="no-print" style={{ maxWidth: 560, margin: "0 auto 16px", display: "flex", justifyContent: "space-between" }}>
        <button className="btn secondary" onClick={() => navigate(-1)}>
          رجوع
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to="/" className="btn secondary">
            الصفحة الرئيسية
          </Link>
          <button className="btn" onClick={() => window.print()}>
            طباعة السند
          </button>
        </div>
      </div>

      <DisbursementVoucherBody support={support} />
    </div>
  );
}
