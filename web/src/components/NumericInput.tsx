import { InputHTMLAttributes } from "react";
import { sanitizeNumericInput } from "../lib/numeric";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type" | "value"> {
  value: string;
  onChange: (value: string) => void;
}

// بديل عن <input type="number"> — يقبل الأرقام العربية والإنجليزية معاً، بخلاف حقل
// النوع "number" في المتصفح الذي يرفض الأرقام العربية تماماً (لا يظهر أي خطأ، فقط
// يبدو الحقل معطّلاً عند الكتابة، ولا يستجيب إلا لأزرار الزيادة/النقص).
export default function NumericInput({ value, onChange, ...rest }: Props) {
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(sanitizeNumericInput(e.target.value))}
      {...rest}
    />
  );
}
