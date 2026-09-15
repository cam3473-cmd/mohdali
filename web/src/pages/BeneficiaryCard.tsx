import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import IdCard from "../components/IdCard";

export default function BeneficiaryCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.get(`/beneficiaries/${id}`).then((res) => setData(res.data));
  }, [id]);

  if (!data) return <p className="loading">جارٍ التحميل...</p>;

  return (
    <div style={{ background: "#f5f7f6", minHeight: "100vh", padding: 24 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="no-print" style={{ maxWidth: 400, margin: "0 auto 16px", display: "flex", justifyContent: "space-between" }}>
        <button className="btn secondary" onClick={() => navigate(-1)}>
          رجوع
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to="/" className="btn secondary">
            الصفحة الرئيسية
          </Link>
          <button className="btn" onClick={() => window.print()}>
            طباعة البطاقة
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 400, margin: "0 auto" }}>
        <IdCard beneficiary={data} />
      </div>
    </div>
  );
}
