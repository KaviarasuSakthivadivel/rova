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

function LoadingScreen() {
  return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;

  return <Layout>{children}</Layout>;
}

/** Admin-only routes — server-side enforcement is what actually matters
 * (requireAdmin on every admin/discovery route), this just keeps a
 * non-admin from landing on a page that will only 403 on every request. */
function AdminRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/" replace />;

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
        path="/admin/crawl-health"
        element={
          <AdminRoute>
            <CrawlHealth />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/discovery"
        element={
          <AdminRoute>
            <Discovery />
          </AdminRoute>
        }
      />
      <Route path="/admin" element={<Navigate to="/admin/crawl-health" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
