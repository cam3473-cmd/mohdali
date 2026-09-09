import { FormEvent, useEffect, useState } from "react";
import { api, apiErrorMessage } from "../lib/api";

export default function Users() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: "", fullName: "", password: "" });
  const [error, setError] = useState("");

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

  async function resetPassword(id: string) {
    const password = prompt("أدخل كلمة المرور الجديدة (٦ أحرف على الأقل):");
    if (!password) return;
    if (password.length < 6) {
      alert("كلمة المرور قصيرة جداً");
      return;
    }
    await api.put(`/users/${id}`, { password });
    alert("تم تحديث كلمة المرور");
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
                    <button className="btn secondary small" onClick={() => resetPassword(u.id)}>
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
    </div>
  );
}
