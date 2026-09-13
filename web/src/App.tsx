import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { useDraggableModals } from "./lib/useDraggableModals";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Beneficiaries from "./pages/Beneficiaries";
import BeneficiaryDetail from "./pages/BeneficiaryDetail";
import BeneficiaryCard from "./pages/BeneficiaryCard";
import BeneficiaryCardsAll from "./pages/BeneficiaryCardsAll";
import Supports from "./pages/Supports";
import SupportVoucher from "./pages/SupportVoucher";
import Batches from "./pages/Batches";
import BatchDetail from "./pages/BatchDetail";
import BatchReceiptVoucher from "./pages/BatchReceiptVoucher";
import Courses from "./pages/Courses";
import CourseDetail from "./pages/CourseDetail";
import Reports from "./pages/Reports";
import Users from "./pages/Users";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/beneficiaries/:id/card"
        element={
          <RequireAuth>
            <BeneficiaryCard />
          </RequireAuth>
        }
      />
      <Route
        path="/beneficiaries/cards"
        element={
          <RequireAuth>
            <BeneficiaryCardsAll />
          </RequireAuth>
        }
      />
      <Route
        path="/supports/:id/voucher"
        element={
          <RequireAuth>
            <SupportVoucher />
          </RequireAuth>
        }
      />
      <Route
        path="/batches/:id/receipt"
        element={
          <RequireAuth>
            <BatchReceiptVoucher />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/beneficiaries" element={<Beneficiaries />} />
        <Route path="/beneficiaries/:id" element={<BeneficiaryDetail />} />
        <Route path="/supports" element={<Supports />} />
        <Route path="/batches" element={<Batches />} />
        <Route path="/batches/:id" element={<BatchDetail />} />
        <Route path="/courses" element={<Courses />} />
        <Route path="/courses/:id" element={<CourseDetail />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/users" element={<Users />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  useDraggableModals();
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
