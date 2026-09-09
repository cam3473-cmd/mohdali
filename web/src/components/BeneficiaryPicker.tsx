import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface Props {
  value: { id: string; fullName: string } | null;
  onChange: (b: { id: string; fullName: string } | null) => void;
}

export default function BeneficiaryPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.get("/beneficiaries", { params: { q: query, pageSize: 8 } }).then((res) => setResults(res.data.items));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  if (value) {
    return (
      <div className="field">
        <label>المستفيد</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span>{value.fullName}</span>
          <button type="button" className="btn secondary small" onClick={() => onChange(null)}>
            تغيير
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="field" style={{ position: "relative" }}>
      <label>البحث عن المستفيد *</label>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        placeholder="اكتب الاسم أو رقم الهوية..."
      />
      {open && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            insetInlineStart: 0,
            insetInlineEnd: 0,
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 8,
            zIndex: 10,
            maxHeight: 220,
            overflowY: "auto",
            boxShadow: "var(--shadow)",
          }}
        >
          {results.map((r) => (
            <div
              key={r.id}
              style={{ padding: "8px 12px", cursor: "pointer" }}
              onClick={() => {
                onChange({ id: r.id, fullName: r.fullName });
                setOpen(false);
                setQuery("");
              }}
            >
              {r.fullName} — {r.nationalId}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
