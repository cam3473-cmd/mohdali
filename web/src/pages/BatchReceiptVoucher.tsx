import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import Logo from "../components/Logo";
import { SUPPORT_CATEGORY_LABEL, DISTRIBUTION_METHOD_LABEL } from "../lib/constants";

export default function BatchReceiptVoucher() {
  const { id } = useParams();
  const [batch, setBatch] = useState<any>(null);

  useEffect(() => {
    api.get(`/batches/${id}`).then((res) => setBatch(res.data));
  }, [id]);

  if (!batch) return <p className="loading">جارٍ التحميل...</p>;

  const voucherNumber = `REC-${new Date(batch.createdAt).toISOString().slice(0, 10).replace(/-/g, "")}-${batch.id.slice(-5).toUpperCase()}`;

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
            <p className="sub">سند استلام دعم وارد</p>
          </div>
        </div>

        <div className="voucher-title">
          <h3>سند استلام</h3>
          <div className="num">رقم السند: {voucherNumber}</div>
        </div>

        <div className="row">
          <span>اسم الدفعة</span>
          <span>{batch.title}</span>
        </div>
        <div className="row">
          <span>نوع الدعم</span>
          <span>{SUPPORT_CATEGORY_LABEL[batch.category] ?? batch.category}</span>
        </div>
        {batch.quantity != null && batch.unitPrice != null && (
          <div className="row">
            <span>الكمية × سعر الوحدة</span>
            <span>
              {batch.quantity} × {batch.unitPrice.toLocaleString("ar-SA")} ريال
            </span>
          </div>
        )}
        <div className="row">
          <span>الإجمالي المستلَم</span>
          <span>{batch.totalAmount.toLocaleString("ar-SA")} ريال</span>
        </div>
        <div className="row">
          <span>تاريخ الاستلام</span>
          <span>{new Date(batch.receivedDate).toLocaleDateString("ar-SA")}</span>
        </div>
        <div className="row">
          <span>طريقة التوزيع المعتمدة</span>
          <span>{DISTRIBUTION_METHOD_LABEL[batch.distributionMethod]}</span>
        </div>
        {batch.notes && (
          <div className="row">
            <span>ملاحظات</span>
            <span>{batch.notes}</span>
          </div>
        )}

        <div className="voucher-signature">
          <div className="box">
            <div className="line">اسم وتوقيع المستلم (الجمعية)</div>
          </div>
          <div className="box">
            <div className="line">اسم وتوقيع الجهة المانحة (إن وُجد)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
