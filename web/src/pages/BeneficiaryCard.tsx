import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import IdCard from "../components/IdCard";

export default function BeneficiaryCard() {
  const { id } = useParams();
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

      <div className="no-print" style={{ maxWidth: 400, margin: "0 auto 16px", display: "flex", justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => window.print()}>
          طباعة البطاقة
        </button>
      </div>

      <div style={{ maxWidth: 400, margin: "0 auto" }}>
        <IdCard beneficiary={data} />
      </div>
    </div>
  );
}
