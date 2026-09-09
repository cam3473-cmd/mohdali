import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { api, apiErrorMessage } from "../lib/api";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [networkAddresses, setNetworkAddresses] = useState<string[]>([]);

  useEffect(() => {
    api
      .get("/network-info")
      .then((res) => setNetworkAddresses(res.data.addresses))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>جمعية البر الخيرية بمحافظة السليل</h1>
        <p className="subtitle">نظام إدارة بيانات المستفيدين والدعوم</p>
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label>اسم المستخدم</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </div>
        <div className="field">
          <label>كلمة المرور</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "جارٍ الدخول..." : "تسجيل الدخول"}
        </button>
        {networkAddresses.length > 0 && (
          <p style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", marginTop: 16, marginBottom: 0 }}>
            للدخول من جهاز آخر على شبكة الجمعية:
            <br />
            {networkAddresses.map((a) => `http://${a}:${location.port || 4000}`).join(" أو ")}
          </p>
        )}
      </form>
    </div>
  );
}
