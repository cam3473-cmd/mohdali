import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import Logo from "./Logo";

const GENDER_LABEL: Record<string, string> = { MALE: "ذكر", FEMALE: "أنثى" };

export interface IdCardBeneficiary {
  id: string;
  fileNumber?: string | null;
  nationalId: string;
  fullName: string;
  gender: string;
  neighborhood?: string | null;
  phone?: string | null;
}

export default function IdCard({ beneficiary }: { beneficiary: IdCardBeneficiary }) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    QRCode.toDataURL(beneficiary.nationalId, {
      width: 150,
      margin: 1,
      color: { dark: "#0a5038", light: "#ffffff" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [beneficiary.nationalId]);

  useEffect(() => {
    if (!barcodeRef.current) return;
    try {
      JsBarcode(barcodeRef.current, beneficiary.nationalId, {
        format: "CODE128",
        width: 1.6,
        height: 38,
        fontSize: 11,
        margin: 4,
        lineColor: "#0a5038",
      });
    } catch {
      // رقم هوية غير صالح لترميز الباركود — يبقى QR كافياً للمسح
    }
  }, [beneficiary.nationalId]);

  return (
    <div className="id-card">
      <div className="id-card-head">
        <Logo size={40} />
        <div>
          <h2>جمعية البر الخيرية بمحافظة السليل</h2>
          <p className="subtitle">بطاقة مستفيد</p>
        </div>
        {beneficiary.fileNumber && <div className="id-card-serial">{beneficiary.fileNumber}</div>}
      </div>

      <div className="row">
        <span>الاسم</span>
        <span>{beneficiary.fullName}</span>
      </div>
      <div className="row">
        <span>رقم الهوية</span>
        <span>{beneficiary.nationalId}</span>
      </div>
      <div className="row">
        <span>الجنس</span>
        <span>{GENDER_LABEL[beneficiary.gender] ?? beneficiary.gender}</span>
      </div>
      <div className="row">
        <span>الحي</span>
        <span>{beneficiary.neighborhood || "-"}</span>
      </div>
      <div className="row">
        <span>الجوال</span>
        <span>{beneficiary.phone || "-"}</span>
      </div>

      <div className="id-card-codes">
        {qrDataUrl && <img src={qrDataUrl} alt="رمز QR لرقم الهوية" width={92} height={92} />}
        <svg ref={barcodeRef} />
      </div>
    </div>
  );
}
