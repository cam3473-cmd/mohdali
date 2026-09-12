import { useState } from "react";

interface Props {
  size?: number;
}

// شعار مرسوم كـ SVG داخل الكود (حلقتان خضراء وذهبية + سنبلة قمح + ورقتان + شريط التأسيس)
// يظهر فوراً دون الحاجة لأي ملف خارجي. إن أُضيف web/public/logo.png لاحقاً بالشعار الرسمي
// الدقيق، يحل محل هذا الرسم تلقائياً دون أي تعديل في الكود.
function DrawnEmblem({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 150 150" width={size} height={size} role="img" aria-label="شعار جمعية البر الخيرية بمحافظة السليل">
      <circle cx="75" cy="75" r="72" fill="#ffffff" />
      <circle cx="75" cy="75" r="70" fill="none" stroke="#0a5038" strokeWidth="3" />
      <circle cx="75" cy="75" r="62" fill="none" stroke="#0a5038" strokeWidth="1.3" />
      <circle cx="75" cy="75" r="55" fill="none" stroke="#b8860a" strokeWidth="1.1" />
      <circle cx="13" cy="75" r="2.4" fill="#0a5038" />
      <circle cx="137" cy="75" r="2.4" fill="#0a5038" />

      <defs>
        <g id="logo-grain">
          <path d="M0,0 C-6,-3 -7,-12 0,-18 C7,-12 6,-3 0,0 Z" fill="#b8860a" />
        </g>
      </defs>

      <path d="M46,131 L104,131 L114,142 L96,138 L75,143 L54,138 L36,142 Z" fill="#ffffff" stroke="#0a5038" strokeWidth="1.3" />
      <text x="75" y="139" textAnchor="middle" fontFamily="Cairo, Almarai, sans-serif" fontSize="8.5" fontWeight="700" fill="#0a5038">
        تأسست ١٤١٥هـ
      </text>

      <path d="M40,124 C34,120 34,113 40,109 C38,115 38,119 40,124 Z" fill="#b8860a" />
      <path d="M110,124 C116,120 116,113 110,109 C112,115 112,119 110,124 Z" fill="#b8860a" />

      <path d="M75,120 C58,116 44,122 34,109 C46,104 58,107 68,114 C71,116 73,118 75,120 Z" fill="#1f7a3f" />
      <path d="M75,120 C92,116 106,122 116,109 C104,104 92,107 82,114 C79,116 77,118 75,120 Z" fill="#1f7a3f" />

      <line x1="75" y1="120" x2="75" y2="30" stroke="#b8860a" strokeWidth="2.6" strokeLinecap="round" />

      <use href="#logo-grain" transform="translate(75,108) rotate(-20)" />
      <use href="#logo-grain" transform="translate(75,108) rotate(20)" />
      <use href="#logo-grain" transform="translate(75,92) rotate(-24) scale(0.95)" />
      <use href="#logo-grain" transform="translate(75,92) rotate(24) scale(0.95)" />
      <use href="#logo-grain" transform="translate(75,76) rotate(-26) scale(0.88)" />
      <use href="#logo-grain" transform="translate(75,76) rotate(26) scale(0.88)" />
      <use href="#logo-grain" transform="translate(75,60) rotate(-24) scale(0.78)" />
      <use href="#logo-grain" transform="translate(75,60) rotate(24) scale(0.78)" />
      <use href="#logo-grain" transform="translate(75,44) rotate(-18) scale(0.66)" />
      <use href="#logo-grain" transform="translate(75,44) rotate(18) scale(0.66)" />
      <use href="#logo-grain" transform="translate(75,30) scale(0.6)" />
    </svg>
  );
}

export default function Logo({ size = 56 }: Props) {
  const [useFallback, setUseFallback] = useState(false);

  if (useFallback) return <DrawnEmblem size={size} />;

  return (
    <img
      src="/logo.png"
      alt="شعار جمعية البر الخيرية بمحافظة السليل"
      width={size}
      height={size}
      style={{ objectFit: "contain" }}
      onError={() => setUseFallback(true)}
    />
  );
}
