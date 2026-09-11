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
    <div className="grid min-h-screen bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
      <div className="hidden flex-col justify-between border-r-2 border-rule-strong bg-ink px-12 py-12 text-paper lg:flex">
        <span className="font-display text-3xl font-semibold italic">Rova</span>
        <div>
          <p className="font-display text-4xl font-medium leading-tight xl:text-5xl">
            Tell us what you've
            <br />
            <span className="font-display-italic text-rust">actually built.</span>
          </p>
          <p className="mt-6 max-w-md font-mono text-sm text-paper/60">
            Your profile and resume drive real matching — every rank comes with a reason grounded in the job
            description, not a keyword score.
          </p>
        </div>
        <span className="font-mono text-xs uppercase tracking-widest text-paper/40">Continuous role discovery</span>
      </div>

      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <span className="mb-10 font-display text-2xl font-semibold italic text-ink lg:hidden">Rova</span>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-faint">Get started</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Create your account</h1>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full border-2 border-ink bg-paper px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-rust focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full border-2 border-ink bg-paper px-3 py-2.5 text-ink focus:border-rust focus:outline-none"
            />
            <p className="mt-1.5 font-mono text-xs text-ink-faint">At least 8 characters.</p>
          </div>
          {error && <p className="border-l-2 border-rust bg-rust-tint px-3 py-2 text-sm text-rust-dim">{error}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-ink px-4 py-3 text-sm font-semibold uppercase tracking-wide text-paper transition-colors hover:bg-rust disabled:opacity-50"
          >
            {isSubmitting ? "Creating account…" : "Sign up"}
          </button>
        </form>
        <p className="mt-6 text-sm text-ink-soft">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-ink underline decoration-rust decoration-2 underline-offset-4">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
