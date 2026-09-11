import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/web/lib/auth";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 pb-1 text-[13px] font-semibold uppercase tracking-[0.08em] transition-colors ${
    isActive ? "border-rust text-ink" : "border-transparent text-ink-faint hover:text-ink"
  }`;

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b-2 border-rule-strong bg-paper">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-8">
            <span className="font-display text-2xl font-semibold italic tracking-tight text-ink">Rova</span>
            <nav className="hidden gap-6 sm:flex">
              <NavLink to="/" end className={navLinkClass}>
                Jobs
              </NavLink>
              <NavLink to="/profile" className={navLinkClass}>
                Profile
              </NavLink>
              {user?.role === "admin" && (
                <>
                  <NavLink to="/admin/crawl-health" className={navLinkClass}>
                    Crawl health
                  </NavLink>
                  <NavLink to="/admin/discovery" className={navLinkClass}>
                    Discovery
                  </NavLink>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden font-mono text-xs text-ink-faint sm:inline">{user?.email}</span>
            <button
              type="button"
              onClick={() => logout()}
              className="border border-ink px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink transition-colors hover:bg-ink hover:text-paper"
            >
              Log out
            </button>
          </div>
        </div>
        <nav className="flex gap-5 overflow-x-auto border-t border-rule px-5 py-2 sm:hidden">
          <NavLink to="/" end className={navLinkClass}>
            Jobs
          </NavLink>
          <NavLink to="/profile" className={navLinkClass}>
            Profile
          </NavLink>
          {user?.role === "admin" && (
            <>
              <NavLink to="/admin/crawl-health" className={navLinkClass}>
                Crawl health
              </NavLink>
              <NavLink to="/admin/discovery" className={navLinkClass}>
                Discovery
              </NavLink>
            </>
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">{children}</main>
    </div>
  );
}
