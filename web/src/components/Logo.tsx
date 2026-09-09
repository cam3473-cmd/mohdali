import { useState } from "react";

interface Props {
  size?: number;
}

// يعرض شعار الجمعية من web/public/logo.png إن وُجد، ويختفي بصمت إن لم يُضَف الملف بعد
export default function Logo({ size = 56 }: Props) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src="/logo.png"
      alt="شعار جمعية البر الخيرية بمحافظة السليل"
      width={size}
      height={size}
      style={{ objectFit: "contain" }}
      onError={() => setFailed(true)}
    />
  );
}
