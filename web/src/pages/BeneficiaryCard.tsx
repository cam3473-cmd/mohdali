import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import QRCode from "qrcode";
import { api } from "../lib/api";
import Logo from "../components/Logo";

const GENDER_LABEL: Record<string, string> = { MALE: "ذكر", FEMALE: "أنثى" };

export default function BeneficiaryCard() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    api.get(`/beneficiaries/${id}`).then((res) => setData(res.data));
  }, [id]);

  useEffect(() => {
    if (!data) return;
    QRCode.toDataURL(data.nationalId, { width: 180, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [data]);

  if (!data) return <p className="loading">جارٍ التحميل...</p>;

  return (
    <div style={{ background: "#f5f7f6", minHeight: "100vh", padding: 24 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
        .id-card {
          width: 400px;
          border: 2px solid #0f6e4f;
          border-radius: 14px;
          padding: 20px;
          background: #fff;
          margin: 0 auto;
          font-family: inherit;
        }
        .id-card h2 { margin: 8px 0 2px; font-size: 16px; color: #0a5038; text-align: center; }
        .id-card .subtitle { text-align: center; font-size: 11px; color: #6b7a72; margin-bottom: 14px; }
        .id-card .row { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; border-bottom: 1px dashed #dfe6e2; }
        .id-card .row span:first-child { color: #6b7a72; }
        .id-card .row span:last-child { font-weight: 600; }
        .id-card .qr-wrap { text-align: center; margin-top: 14px; }
      `}</style>

      <div className="no-print" style={{ maxWidth: 400, margin: "0 auto 16px", display: "flex", justifyContent: "flex-end" }}>
        <button className="btn" onClick={() => window.print()}>
          طباعة البطاقة
        </button>
      </div>

      <div className="id-card">
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Logo size={48} />
        </div>
        <h2>جمعية البر الخيرية بمحافظة السليل</h2>
        <p className="subtitle">بطاقة مستفيد</p>

        <div className="row">
          <span>الاسم</span>
          <span>{data.fullName}</span>
        </div>
        <div className="row">
          <span>رقم الهوية</span>
          <span>{data.nationalId}</span>
        </div>
        <div className="row">
          <span>الجنس</span>
          <span>{GENDER_LABEL[data.gender] ?? data.gender}</span>
        </div>
        <div className="row">
          <span>الحي</span>
          <span>{data.neighborhood || "-"}</span>
        </div>
        <div className="row">
          <span>الجوال</span>
          <span>{data.phone || "-"}</span>
        </div>

        <div className="qr-wrap">
          {qrDataUrl && <img src={qrDataUrl} alt="رمز QR لرقم الهوية" width={140} height={140} />}
        </div>
      </div>
    </div>
  );
}
