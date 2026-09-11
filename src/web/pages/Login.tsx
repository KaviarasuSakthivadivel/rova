import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "@/web/lib/api";
import { useAuth } from "@/web/lib/auth";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">R</div>
          <span className="text-xl font-extrabold text-ink">Rova</span>
        </div>

        <div className="rounded-2xl bg-panel p-7 shadow-sm">
          <h1 className="text-xl font-bold text-ink">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-muted">Log in to see what's new.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-3.5">
            <div>
              <label htmlFor="email" className="text-xs font-semibold text-ink-muted">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl bg-panel-soft px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div>
              <label htmlFor="password" className="text-xs font-semibold text-ink-muted">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-xl bg-panel-soft px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            {error && <p className="rounded-xl bg-red-soft px-3.5 py-2.5 text-sm text-red">{error}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-full bg-brand py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
            >
              {isSubmitting ? "Logging in…" : "Log in"}
            </button>
          </form>
        </div>
        <p className="mt-5 text-center text-sm text-ink-muted">
          No account?{" "}
          <Link to="/signup" className="font-bold text-brand hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
