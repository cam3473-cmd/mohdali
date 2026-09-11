import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { SUPPORT_CATEGORY_LABEL } from "../lib/constants";

export default function CampaignDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const preselectId = searchParams.get("preselect");
  const [campaign, setCampaign] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [q, setQ] = useState("");
  const [beneficiaries, setBeneficiaries] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [sharedDescription, setSharedDescription] = useState("");
  const [preselected, setPreselected] = useState(false);

  async function loadCampaign() {
    setLoading(true);
    try {
      const res = await api.get(`/campaigns/${id}`);
      setCampaign(res.data);
    } finally {
      setLoading(false);
    }
  }

  async function loadBeneficiaries() {
    const res = await api.get("/beneficiaries", { params: { q: q || undefined, status: "ACTIVE", pageSize: 200 } });
    setBeneficiaries(res.data.items);
  }

  useEffect(() => {
    loadCampaign();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const t = setTimeout(loadBeneficiaries, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // عند القدوم من صفحة مستفيد محدد، حدّده تلقائياً مع إتاحة إضافة آخرين معه
  useEffect(() => {
    if (!campaign || !preselectId || preselected) return;
    setPreselected(true);
    api
      .get(`/beneficiaries/${preselectId}`)
      .then((res) => {
        const b = res.data;
        setBeneficiaries((prev) => (prev.some((x) => x.id === b.id) ? prev : [b, ...prev]));
        setQ(b.fullName);
        setSelected((prev) => new Set(prev).add(b.id));
        setAmounts((a) => {
          if (a[b.id]) return a;
          const rate = campaign.perPersonRate ?? 0;
          const members = b.familyMembersCount ?? 1;
          return { ...a, [b.id]: String(Math.round(rate * members * 100) / 100) };
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, preselectId]);

  function toggleSelect(b: any) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(b.id)) {
        next.delete(b.id);
      } else {
        next.add(b.id);
        if (!amounts[b.id]) {
          const rate = campaign?.perPersonRate ?? 0;
          const members = b.familyMembersCount ?? 1;
          setAmounts((a) => ({ ...a, [b.id]: String(Math.round(rate * members * 100) / 100) }));
        }
      }
      return next;
    });
  }

  function selectAllVisible() {
    const next = new Set(selected);
    beneficiaries.forEach((b) => {
      next.add(b.id);
      if (!amounts[b.id]) {
        const rate = campaign?.perPersonRate ?? 0;
        const members = b.familyMembersCount ?? 1;
        setAmounts((a) => ({ ...a, [b.id]: String(Math.round(rate * members * 100) / 100) }));
      }
    });
    setSelected(next);
  }

  function clearSelection() {
    setSelected(new Set());
  }

  const totalSelected = Array.from(selected).reduce((sum, bid) => sum + (Number(amounts[bid]) || 0), 0);

  async function confirmDistribution() {
    setError("");
    if (selected.size === 0) {
      setError("الرجاء اختيار مستفيد واحد على الأقل");
      return;
    }
    if (!confirm(`سيتم إنشاء ${selected.size} سجل دعم بإجمالي ${totalSelected.toLocaleString("ar-SA")} ريال. هل تريد المتابعة؟`)) return;

    setSubmitting(true);
    try {
      const items = Array.from(selected).map((beneficiaryId) => ({
        beneficiaryId,
        amount: Number(amounts[beneficiaryId]) || 0,
        description: sharedDescription || null,
      }));
      await api.post(`/campaigns/${id}/distribute`, { items });
      clearSelection();
      setSharedDescription("");
      loadCampaign();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !campaign) return <p className="loading">جارٍ التحميل...</p>;

  const alreadyDistributedIds = new Set(campaign.supports.map((s: any) => s.beneficiaryId));

  return (
    <div>
      <div className="page-header">
        <h2>{campaign.title}</h2>
        <Link to="/campaigns" className="btn secondary">
          رجوع إلى دفعات الدعم
        </Link>
      </div>

      <div className="card">
        <div className="form-grid">
          <div>
            <strong>النوع:</strong> {SUPPORT_CATEGORY_LABEL[campaign.category] ?? campaign.category}
          </div>
          <div>
            <strong>نصيب الفرد:</strong> {campaign.perPersonRate != null ? `${campaign.perPersonRate.toLocaleString("ar-SA")} ريال` : "-"}
          </div>
          <div>
            <strong>تاريخ التوزيع:</strong> {new Date(campaign.distributionDate).toLocaleDateString("ar-SA")}
          </div>
          <div>
            <strong>عدد المستفيدين المشمولين حتى الآن:</strong> {campaign.supports.length}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>اختيار المستفيدين للتوزيع</h3>
        {error && <div className="error-banner">{error}</div>}
        <div className="toolbar">
          <input placeholder="بحث بالاسم أو رقم الهوية..." value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
          <button className="btn secondary small" onClick={selectAllVisible}>
            تحديد كل الظاهرين
          </button>
          <button className="btn secondary small" onClick={clearSelection}>
            إلغاء التحديد
          </button>
        </div>

        <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>الاسم</th>
                <th>عدد أفراد الأسرة</th>
                <th>المبلغ المقترح (قابل للتعديل)</th>
              </tr>
            </thead>
            <tbody>
              {beneficiaries.map((b) => {
                const isDistributed = alreadyDistributedIds.has(b.id);
                return (
                  <tr key={b.id} style={isDistributed ? { opacity: 0.5 } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(b.id)}
                        onChange={() => toggleSelect(b)}
                        disabled={isDistributed}
                      />
                    </td>
                    <td>
                      {b.fullName} {isDistributed && <span style={{ fontSize: 12, color: "var(--muted)" }}>(شمله التوزيع مسبقاً)</span>}
                    </td>
                    <td>{b.familyMembersCount ?? "-"}</td>
                    <td>
                      <input
                        type="number"
                        style={{ width: 110 }}
                        value={amounts[b.id] ?? ""}
                        onChange={(e) => setAmounts({ ...amounts, [b.id]: e.target.value })}
                        disabled={!selected.has(b.id)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="form-grid" style={{ marginTop: 14 }}>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>وصف/ملاحظة مشتركة (اختياري، تُطبَّق على جميع السجلات المُنشأة)</label>
            <input value={sharedDescription} onChange={(e) => setSharedDescription(e.target.value)} />
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 10 }}>
          <span>
            المحدَّدون: <strong>{selected.size}</strong> — الإجمالي: <strong>{totalSelected.toLocaleString("ar-SA")} ريال</strong>
          </span>
          <button className="btn" style={{ marginRight: "auto" }} onClick={confirmDistribution} disabled={submitting || selected.size === 0}>
            {submitting ? "جارٍ التوزيع..." : "تأكيد التوزيع"}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>سجلات الدعم المُنشأة من هذه الحملة ({campaign.supports.length})</h3>
        {campaign.supports.length === 0 ? (
          <p className="empty-state">لم يتم توزيع أي دعم بعد</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>المستفيد</th>
                <th>المبلغ</th>
                <th>التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {campaign.supports.map((s: any) => (
                <tr key={s.id}>
                  <td>{s.beneficiary.fullName}</td>
                  <td>{s.amount != null ? `${s.amount.toLocaleString("ar-SA")} ريال` : "-"}</td>
                  <td>{new Date(s.supportDate).toLocaleDateString("ar-SA")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
