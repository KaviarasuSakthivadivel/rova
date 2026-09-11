import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/web/lib/auth";

function NavIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] shrink-0" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  jobs: "M5 7h14M5 12h14M5 17h9",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9c1.2-4 4-6 7-6s5.8 2 7 6",
  crawl: "M4 5h16v14H4V5Zm3 4h10v2H7V9Zm0 4h10v2H7v-2Z",
  discovery: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9.5 16.5-4.8-4.8",
};

function NavItem({ to, end, icon, children }: { to: string; end?: boolean; icon: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? "bg-sidebar-active text-white" : "text-white/65 hover:bg-sidebar-hover hover:text-white"
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
    <div className="flex min-h-screen bg-bg">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-sidebar sm:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">R</div>
          <span className="text-base font-bold text-white">Rova</span>
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
              <p className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/35">Admin</p>
              <NavItem to="/admin/crawl-health" icon={ICONS.crawl}>
                Crawl health
              </NavItem>
              <NavItem to="/admin/discovery" icon={ICONS.discovery}>
                Discovery
              </NavItem>
            </>
          )}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-xs text-white/50">{user?.email}</span>
            <button type="button" onClick={() => logout()} className="shrink-0 text-xs font-semibold text-white/60 hover:text-white">
              Log out
            </button>
          </div>
        </div>
      </aside>

      <div className="fixed inset-x-0 top-0 z-10 flex items-center justify-between bg-sidebar px-4 py-3 sm:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent text-xs font-bold text-white">R</div>
          <span className="text-sm font-bold text-white">Rova</span>
        </div>
        <button type="button" onClick={() => logout()} className="text-xs font-semibold text-white/70">
          Log out
        </button>
      </div>

      <div className="flex w-full flex-col pt-14 sm:ml-64 sm:pt-0">
        <nav className="flex gap-1 overflow-x-auto bg-sidebar px-3 py-2 sm:hidden">
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
        <main className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-10">{children}</main>
      </div>
    </div>
  );
}
