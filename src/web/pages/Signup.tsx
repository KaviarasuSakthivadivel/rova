import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "@/web/lib/api";
import { useAuth } from "@/web/lib/auth";

export function Signup() {
  const { signup } = useAuth();
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
      await signup(email, password);
      navigate("/profile");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-container-low px-4">
      <div className="w-full max-w-sm rounded-3xl bg-surface-container-lowest p-8 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-base font-bold text-on-primary">
            R
          </div>
          <span className="text-xl font-medium text-on-surface">Rova</span>
        </div>

        <h1 className="mt-6 text-2xl font-medium text-on-surface">Create your account</h1>
        <p className="mt-1 text-sm text-on-surface-variant">Free to start — set up your profile in a minute.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="text-sm font-medium text-on-surface-variant">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-outline bg-transparent px-4 py-3 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-sm font-medium text-on-surface-variant">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-outline bg-transparent px-4 py-3 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1.5 text-xs text-on-surface-variant">At least 8 characters.</p>
          </div>
          {error && (
            <p className="rounded-xl bg-error-container px-4 py-2.5 text-sm text-on-error-container">{error}</p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="state-layer w-full rounded-full bg-primary px-6 py-3 text-sm font-medium text-on-primary shadow-sm disabled:opacity-50"
          >
            {isSubmitting ? "Creating account…" : "Sign up"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-on-surface-variant">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
