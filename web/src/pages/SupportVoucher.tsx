import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import Logo from "../components/Logo";
import { SUPPORT_CATEGORY_LABEL } from "../lib/constants";

export default function SupportVoucher() {
  const { id } = useParams();
  const [support, setSupport] = useState<any>(null);

  useEffect(() => {
    api.get(`/supports/${id}`).then((res) => setSupport(res.data));
  }, [id]);

  if (!support) return <p className="loading">جارٍ التحميل...</p>;

  const voucherNumber = `DIS-${new Date(support.createdAt).toISOString().slice(0, 10).replace(/-/g, "")}-${support.id.slice(-5).toUpperCase()}`;

  return (
    <div style={{ background: "#f5f7f6", minHeight: "100vh", padding: 24 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="no-print" style={{ maxWidth: 560, margin: "0 auto 16px", display: "flex", justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => window.print()}>
          طباعة السند
        </button>
      </div>

      <div className="voucher">
        <div className="voucher-head">
          <Logo size={44} />
          <div>
            <h2>جمعية البر الخيرية بمحافظة السليل</h2>
            <p className="sub">سند صرف دعم لمستفيد</p>
          </div>
        </div>

        <div className="voucher-title">
          <h3>سند صرف</h3>
          <div className="num">رقم السند: {voucherNumber}</div>
        </div>

        <div className="row">
          <span>اسم المستفيد</span>
          <span>{support.beneficiary.fullName}</span>
        </div>
        <div className="row">
          <span>رقم الهوية</span>
          <span>{support.beneficiary.nationalId}</span>
        </div>
        <div className="row">
          <span>نوع الدعم</span>
          <span>{SUPPORT_CATEGORY_LABEL[support.category] ?? support.category}</span>
        </div>
        <div className="row">
          <span>المبلغ/القيمة</span>
          <span>{support.amount != null ? `${support.amount.toLocaleString("ar-SA")} ريال` : "-"}</span>
        </div>
        {support.description && (
          <div className="row">
            <span>الوصف</span>
            <span>{support.description}</span>
          </div>
        )}
        <div className="row">
          <span>تاريخ الصرف</span>
          <span>{new Date(support.supportDate).toLocaleDateString("ar-SA")}</span>
        </div>
        {support.batch && (
          <div className="row">
            <span>الدفعة المصدر</span>
            <span>{support.batch.title}</span>
          </div>
        )}

        <div className="voucher-signature">
          <div className="box">
            <div className="line">اسم وتوقيع المستفيد (استلام)</div>
          </div>
          <div className="box">
            <div className="line">اسم وتوقيع موظف الصرف</div>
          </div>
        </div>
      </div>
    </div>
  );
}
