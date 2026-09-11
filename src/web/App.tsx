import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "@/web/components/Layout";
import { useAuth } from "@/web/lib/auth";
import { CrawlHealth } from "@/web/pages/CrawlHealth";
import { Dashboard } from "@/web/pages/Dashboard";
import { Discovery } from "@/web/pages/Discovery";
import { Login } from "@/web/pages/Login";
import { Profile } from "@/web/pages/Profile";
import { Signup } from "@/web/pages/Signup";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  return <Layout>{children}</Layout>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <Profile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/crawl-health"
        element={
          <ProtectedRoute>
            <CrawlHealth />
          </ProtectedRoute>
        }
      />
      <Route
        path="/discovery"
        element={
          <ProtectedRoute>
            <Discovery />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
