import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../lib/api";
import { SUPPORT_CATEGORY_LABEL, DISTRIBUTION_METHOD_LABEL } from "../lib/constants";

function suggestedAmount(batch: any, familyMembersCount: number | null | undefined) {
  if (batch.distributionMethod === "UNIFIED") {
    return batch.unifiedAmount ?? 0;
  }
  const dependents = Math.max((familyMembersCount ?? 1) - 1, 0);
  return (batch.headAmount ?? 0) + (batch.dependentAmount ?? 0) * dependents;
}

export default function BatchDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const preselectId = searchParams.get("preselect");
  const [batch, setBatch] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [q, setQ] = useState("");
  const [beneficiaries, setBeneficiaries] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [sharedDescription, setSharedDescription] = useState("");
  const [preselected, setPreselected] = useState(false);

  async function loadBatch() {
    setLoading(true);
    try {
      const res = await api.get(`/batches/${id}`);
      setBatch(res.data);
    } finally {
      setLoading(false);
    }
  }

  async function loadBeneficiaries() {
    const res = await api.get("/beneficiaries", { params: { q: q || undefined, status: "ACTIVE", pageSize: 5000 } });
    setBeneficiaries(res.data.items);
  }

  useEffect(() => {
    loadBatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const t = setTimeout(loadBeneficiaries, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    if (!batch || !preselectId || preselected) return;
    setPreselected(true);
    api
      .get(`/beneficiaries/${preselectId}`)
      .then((res) => {
        const b = res.data;
        setBeneficiaries((prev) => (prev.some((x) => x.id === b.id) ? prev : [b, ...prev]));
        setQ(b.fullName);
        setSelected((prev) => new Set(prev).add(b.id));
        setAmounts((a) => (a[b.id] ? a : { ...a, [b.id]: String(suggestedAmount(batch, b.familyMembersCount)) }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, preselectId]);

  function toggleSelect(b: any) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(b.id)) {
        next.delete(b.id);
      } else {
        next.add(b.id);
        if (!amounts[b.id]) {
          setAmounts((a) => ({ ...a, [b.id]: String(suggestedAmount(batch, b.familyMembersCount)) }));
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
        setAmounts((a) => ({ ...a, [b.id]: String(suggestedAmount(batch, b.familyMembersCount)) }));
      }
    });
    setSelected(next);
  }

  function clearSelection() {
    setSelected(new Set());
  }

  const totalSelected = Array.from(selected).reduce((sum, bid) => sum + (Number(amounts[bid]) || 0), 0);
  const exceedsRemaining = batch && totalSelected > batch.remainingAmount;

  async function confirmDistribution() {
    setError("");
    if (selected.size === 0) {
      setError("الرجاء اختيار مستفيد واحد على الأقل");
      return;
    }
    let confirmMsg = `سيتم إنشاء ${selected.size} سجل دعم بإجمالي ${totalSelected.toLocaleString("ar-SA")} ريال. هل تريد المتابعة؟`;
    if (exceedsRemaining) {
      confirmMsg = `تنبيه: المطلوب توزيعه (${totalSelected.toLocaleString("ar-SA")}) يتجاوز الرصيد المتبقي في الدفعة (${batch.remainingAmount.toLocaleString("ar-SA")} ريال). هل تريد المتابعة رغم ذلك؟`;
    }
    if (!confirm(confirmMsg)) return;

    setSubmitting(true);
    try {
      const items = Array.from(selected).map((beneficiaryId) => ({
        beneficiaryId,
        amount: Number(amounts[beneficiaryId]) || 0,
        description: sharedDescription || null,
      }));
      await api.post(`/batches/${id}/distribute`, { items });
      clearSelection();
      setSharedDescription("");
      loadBatch();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function closeBatch() {
    if (!confirm("هل تريد إغلاق هذه الدفعة؟ لن يمكن التوزيع منها بعد الإغلاق (يمكن إعادة فتحها لاحقاً إن لزم).")) return;
    await api.post(`/batches/${id}/close`);
    loadBatch();
  }

  async function reopenBatch() {
    await api.post(`/batches/${id}/reopen`);
    loadBatch();
  }

  if (loading || !batch) return <p className="loading">جارٍ التحميل...</p>;

  const alreadyDistributedIds = new Set(batch.supports.map((s: any) => s.beneficiaryId));
  const isClosed = batch.status === "CLOSED";

  return (
    <div>
      <div className="page-header">
        <h2>{batch.title}</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/batches/${id}/receipt`} className="btn secondary">
            سند استلام
          </Link>
          <Link to="/batches" className="btn secondary">
            رجوع إلى دفعات الدعم
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="form-grid">
          <div>
            <strong>النوع:</strong> {SUPPORT_CATEGORY_LABEL[batch.category] ?? batch.category}
          </div>
          <div>
            <strong>طريقة التوزيع:</strong> {DISTRIBUTION_METHOD_LABEL[batch.distributionMethod]}
          </div>
          <div>
            <strong>تاريخ الاستلام:</strong> {new Date(batch.receivedDate).toLocaleDateString("ar-SA")}
          </div>
          <div>
            <strong>الحالة:</strong> {isClosed ? "مغلقة" : "مفتوحة"}
          </div>
          <div>
            <strong>الإجمالي المسجَّل:</strong> {batch.totalAmount.toLocaleString("ar-SA")} ريال
          </div>
          <div>
            <strong>الموزَّع حتى الآن:</strong> {batch.distributedAmount.toLocaleString("ar-SA")} ريال
          </div>
          <div>
            <strong>المتبقي:</strong> {batch.remainingAmount.toLocaleString("ar-SA")} ريال
          </div>
          <div>
            {isClosed ? (
              <button className="btn secondary small" onClick={reopenBatch}>
                إعادة فتح الدفعة
              </button>
            ) : (
              <button className="btn danger small" onClick={closeBatch}>
                إغلاق الدفعة
              </button>
            )}
          </div>
        </div>
      </div>

      {isClosed ? (
        <div className="card">
          <p className="empty-state">هذه الدفعة مغلقة — أعد فتحها لإجراء توزيع إضافي منها.</p>
        </div>
      ) : (
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
                        <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggleSelect(b)} />
                      </td>
                      <td>
                        {b.fullName} {isDistributed && <span style={{ fontSize: 12, color: "var(--muted)" }}>(شمله التوزيع سابقاً)</span>}
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

          {exceedsRemaining && (
            <div className="error-banner">
              تنبيه: المطلوب توزيعه يتجاوز الرصيد المتبقي في الدفعة ({batch.remainingAmount.toLocaleString("ar-SA")} ريال فقط) — يمكنك المتابعة رغم ذلك عند التأكيد.
            </div>
          )}

          <div className="toolbar" style={{ marginTop: 10 }}>
            <span>
              المحدَّدون: <strong>{selected.size}</strong> — الإجمالي: <strong>{totalSelected.toLocaleString("ar-SA")} ريال</strong>
            </span>
            <button className="btn" style={{ marginRight: "auto" }} onClick={confirmDistribution} disabled={submitting || selected.size === 0}>
              {submitting ? "جارٍ التوزيع..." : "تأكيد التوزيع"}
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>سجلات الدعم المُنشأة من هذه الدفعة ({batch.supports.length})</h3>
        {batch.supports.length === 0 ? (
          <p className="empty-state">لم يتم توزيع أي دعم بعد</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>المستفيد</th>
                <th>المبلغ</th>
                <th>التاريخ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batch.supports.map((s: any) => (
                <tr key={s.id}>
                  <td>{s.beneficiary.fullName}</td>
                  <td>{s.amount != null ? `${s.amount.toLocaleString("ar-SA")} ريال` : "-"}</td>
                  <td>{new Date(s.supportDate).toLocaleDateString("ar-SA")}</td>
                  <td>
                    <Link to={`/supports/${s.id}/voucher`} className="btn secondary small">
                      سند صرف
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
