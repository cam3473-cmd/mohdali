import { FormEvent, useEffect, useState } from "react";
import { api, apiErrorMessage } from "../lib/api";

export default function Users() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: "", fullName: "", password: "" });
  const [error, setError] = useState("");

  const [resetTarget, setResetTarget] = useState<{ id: string; fullName: string } | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetError, setResetError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/users");
      setItems(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.post("/users", form);
      setForm({ username: "", fullName: "", password: "" });
      setShowForm(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function toggleActive(id: string, active: boolean) {
    await api.put(`/users/${id}`, { active: !active });
    load();
  }

  function openResetPassword(u: { id: string; fullName: string }) {
    setResetTarget(u);
    setResetPasswordValue("");
    setResetError("");
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    if (!resetTarget) return;
    setResetError("");
    try {
      await api.put(`/users/${resetTarget.id}`, { password: resetPasswordValue });
      setResetTarget(null);
    } catch (err) {
      setResetError(apiErrorMessage(err));
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>المستخدمون</h2>
        <button className="btn" onClick={() => setShowForm(true)}>
          + إضافة موظف
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 14, marginTop: -10 }}>
        جميع الموظفين لديهم صلاحيات كاملة متساوية. حساب المستخدم يُستخدم لتسجيل من أدخل كل عملية (المساءلة).
      </p>

      <div className="card">
        {loading ? (
          <p className="loading">جارٍ التحميل...</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>اسم المستخدم</th>
                <th>الحالة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName}</td>
                  <td>{u.username}</td>
                  <td>
                    <span className={`badge ${u.active ? "active" : "closed"}`}>{u.active ? "مفعل" : "معطل"}</span>
                  </td>
                  <td>
                    <button className="btn secondary small" onClick={() => openResetPassword(u)}>
                      تغيير كلمة المرور
                    </button>{" "}
                    <button className="btn secondary small" onClick={() => toggleActive(u.id, u.active)}>
                      {u.active ? "تعطيل" : "تفعيل"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
            <h3>إضافة موظف جديد</h3>
            {error && <div className="error-banner">{error}</div>}
            <div className="form-grid">
              <div className="field">
                <label>الاسم الكامل *</label>
                <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </div>
              <div className="field">
                <label>اسم المستخدم *</label>
                <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
              <div className="field">
                <label>كلمة المرور *</label>
                <input required type="password" minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setShowForm(false)}>
                إلغاء
              </button>
              <button type="submit" className="btn">
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}

      {resetTarget && (
        <div className="modal-backdrop" onClick={() => setResetTarget(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleResetPassword} style={{ maxWidth: 400 }}>
            <h3>تغيير كلمة مرور: {resetTarget.fullName}</h3>
            {resetError && <div className="error-banner">{resetError}</div>}
            <div className="field">
              <label>كلمة المرور الجديدة *</label>
              <input
                required
                type="password"
                minLength={6}
                autoFocus
                value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setResetTarget(null)}>
                إلغاء
              </button>
              <button type="submit" className="btn">
                حفظ
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
