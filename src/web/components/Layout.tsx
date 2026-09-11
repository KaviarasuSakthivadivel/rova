import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/web/lib/auth";

function NavIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  jobs: "M5 7h14M5 12h14M5 17h9",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9c1.2-4 4-6 7-6s5.8 2 7 6",
  crawl: "M4 5h16v14H4V5Zm3 4h10v2H7V9Zm0 4h10v2H7v-2Z",
  discovery: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9.5 16.5-4.8-4.8",
};

// M3 Navigation Drawer item: a full-width pill row, filled with the
// primary-container tone when active rather than an underline/border.
function NavItem({ to, end, icon, children }: { to: string; end?: boolean; icon: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `state-layer flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
          isActive ? "bg-primary-container text-on-primary-container" : "text-on-surface-variant"
        }`
      }
    >
      <NavIcon path={icon} />
      {children}
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen bg-surface">
      <aside className="fixed inset-y-0 left-0 hidden w-72 flex-col border-r border-outline-variant bg-surface-container-low sm:flex">
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">
            R
          </div>
          <span className="text-lg font-medium text-on-surface">Rova</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          <NavItem to="/" end icon={ICONS.jobs}>
            Jobs
          </NavItem>
          <NavItem to="/profile" icon={ICONS.profile}>
            Profile
          </NavItem>

          {user?.role === "admin" && (
            <>
              <p className="mb-1 mt-6 px-4 text-xs font-semibold uppercase tracking-wider text-on-surface-variant/70">
                Admin
              </p>
              <NavItem to="/admin/crawl-health" icon={ICONS.crawl}>
                Crawl health
              </NavItem>
              <NavItem to="/admin/discovery" icon={ICONS.discovery}>
                Discovery
              </NavItem>
            </>
          )}
        </nav>

        <div className="border-t border-outline-variant px-4 py-4">
          <div className="flex items-center gap-3 rounded-2xl px-2 py-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary-container text-sm font-semibold text-on-secondary-container">
              {user?.email?.[0]?.toUpperCase()}
            </div>
            <span className="min-w-0 truncate text-xs text-on-surface-variant">{user?.email}</span>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="state-layer mt-2 w-full rounded-full border border-outline px-4 py-2 text-sm font-medium text-on-surface-variant"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* Compact top app bar — the drawer collapses below sm */}
      <div className="fixed inset-x-0 top-0 z-10 flex items-center justify-between bg-surface-container-low px-4 py-3 shadow-sm sm:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-on-primary">
            R
          </div>
          <span className="text-base font-medium text-on-surface">Rova</span>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="rounded-full border border-outline px-3 py-1 text-xs font-medium text-on-surface-variant"
        >
          Log out
        </button>
      </div>

      <div className="flex w-full flex-col pt-16 sm:ml-72 sm:pt-0">
        <nav className="flex gap-2 overflow-x-auto bg-surface-container-low px-3 py-2 sm:hidden">
          <NavItem to="/" end icon={ICONS.jobs}>
            Jobs
          </NavItem>
          <NavItem to="/profile" icon={ICONS.profile}>
            Profile
          </NavItem>
          {user?.role === "admin" && (
            <>
              <NavItem to="/admin/crawl-health" icon={ICONS.crawl}>
                Crawl
              </NavItem>
              <NavItem to="/admin/discovery" icon={ICONS.discovery}>
                Discovery
              </NavItem>
            </>
          )}
        </nav>
        <main className="mx-auto w-full max-w-5xl px-6 py-8 sm:px-10 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
