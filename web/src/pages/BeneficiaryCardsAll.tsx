import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import IdCard, { IdCardBeneficiary } from "../components/IdCard";

export default function BeneficiaryCardsAll() {
  const [items, setItems] = useState<IdCardBeneficiary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/beneficiaries", { params: { status: "ACTIVE", pageSize: 5000 } })
      .then((res) => setItems(res.data.items))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ background: "#f5f7f6", minHeight: "100vh", padding: 24 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="no-print" style={{ maxWidth: 1200, margin: "0 auto 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>بطاقات جميع المستفيدين ({items.length})</h2>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            بطاقة واحدة لكل مستفيد نشط، جاهزة للطباعة دفعة واحدة على ورق البطاقات.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to="/beneficiaries" className="btn secondary">
            رجوع
          </Link>
          <button className="btn" onClick={() => window.print()} disabled={loading || items.length === 0}>
            طباعة الكل
          </button>
        </div>
      </div>

      {loading ? (
        <p className="loading">جارٍ التحميل...</p>
      ) : items.length === 0 ? (
        <p className="empty-state">لا يوجد مستفيدون نشطون لإصدار بطاقات لهم</p>
      ) : (
        <div className="cards-grid" style={{ maxWidth: 1200, margin: "0 auto" }}>
          {items.map((b) => (
            <IdCard key={b.id} beneficiary={b} />
          ))}
        </div>
      )}
    </div>
  );
}
