import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";

const links = [
  { to: "/", label: "لوحة التحكم", end: true },
  { to: "/beneficiaries", label: "المستفيدون" },
  { to: "/cash-supports", label: "الدعم النقدي" },
  { to: "/in-kind-supports", label: "الدعم العيني" },
  { to: "/courses", label: "الدورات التدريبية" },
  { to: "/reports", label: "التقارير" },
  { to: "/users", label: "المستخدمون" },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>
          جمعية البر الخيرية
          <br />
          بمحافظة السليل
        </h1>
        <nav>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="user-box">
          <div>{user?.fullName}</div>
          <button className="logout-btn" onClick={logout}>
            تسجيل الخروج
          </button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
