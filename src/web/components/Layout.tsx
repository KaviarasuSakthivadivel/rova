import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ThemeSwitcher } from "@/web/components/ThemeSwitcher";
import { useAuth } from "@/web/lib/auth";

function Icon({ path, className = "h-[18px] w-[18px]" }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  jobs: "M4 7h16M4 12h16M4 17h10",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9c1.2-4 4-6 7-6s5.8 2 7 6",
  pipeline: "M4 6h5v5H4V6Zm11 0h5v5h-5V6ZM4 15h5v3H4v-3Zm11 0h5v3h-5v-3ZM9 8.5h6M9 16.5h6",
  crawl: "M4 5h16v14H4V5Zm3 4h10v2H7V9Zm0 4h10v2H7v-2Z",
  discovery: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9.5 16.5-4.8-4.8",
};

interface NavItemDef {
  to: string;
  end?: boolean;
  icon: string;
  label: string;
}

const NAV_ITEMS: NavItemDef[] = [
  { to: "/", end: true, icon: ICONS.jobs, label: "Jobs" },
  { to: "/pipeline", icon: ICONS.pipeline, label: "Pipeline" },
  { to: "/profile", icon: ICONS.profile, label: "Profile" },
];

const ADMIN_NAV_ITEMS: NavItemDef[] = [
  { to: "/admin/crawl-health", icon: ICONS.crawl, label: "Crawl health" },
  { to: "/admin/discovery", icon: ICONS.discovery, label: "Discovery" },
];

const TITLES: { test: (path: string) => boolean; title: string }[] = [
  { test: (p) => p === "/", title: "Jobs" },
  { test: (p) => p.startsWith("/pipeline"), title: "Pipeline" },
  { test: (p) => p.startsWith("/profile"), title: "Profile" },
  { test: (p) => p.startsWith("/admin/crawl-health"), title: "Crawl health" },
  { test: (p) => p.startsWith("/admin/discovery"), title: "Discovery" },
];

function pageTitle(pathname: string): string {
  return TITLES.find((t) => t.test(pathname))?.title ?? "Rova";
}

function NavItem({ to, end, icon, label }: NavItemDef) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
          isActive ? "bg-brand-soft text-brand-ink" : "text-ink-muted hover:bg-panel-soft hover:text-ink"
        }`
      }
    >
      <Icon path={icon} />
      {label}
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const mobileItems = user?.role === "admin" ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS] : NAV_ITEMS;

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-rail sm:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-extrabold text-white">R</div>
          <span className="text-base font-extrabold text-ink">Rova</span>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}

          {user?.role === "admin" && (
            <>
              <p className="mt-5 mb-1 px-3 text-[11px] font-bold tracking-wide text-ink-faint uppercase">Admin</p>
              {ADMIN_NAV_ITEMS.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </>
          )}
        </nav>

        <ThemeSwitcher />

        <div className="flex items-center gap-2.5 border-t border-line px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-panel-soft text-xs font-bold text-ink-muted">
            {user?.email?.[0]?.toUpperCase()}
          </div>
          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-muted">{user?.email}</p>
          <button type="button" onClick={() => logout()} className="shrink-0 text-xs font-bold text-ink-faint hover:text-ink">
            Exit
          </button>
        </div>
      </aside>

      {/* Mobile: a compact top bar instead of the sidebar */}
      <div className="fixed inset-x-0 top-0 z-10 flex items-center justify-between border-b border-line bg-rail px-4 py-2.5 sm:hidden">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-xs font-extrabold text-white">R</div>
        <nav className="flex gap-1">
          {mobileItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex h-8 w-8 items-center justify-center rounded-lg ${isActive ? "bg-brand-soft text-brand-ink" : "text-ink-faint"}`
              }
            >
              <Icon path={item.icon} className="h-4 w-4" />
            </NavLink>
          ))}
        </nav>
        <button type="button" onClick={() => logout()} className="text-[11px] font-bold text-ink-faint">
          Exit
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col pt-12 sm:pt-0">
        <div className="hidden shrink-0 items-center border-b border-line bg-panel px-6 py-3.5 sm:flex">
          <h1 className="text-sm font-bold text-ink">{pageTitle(location.pathname)}</h1>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
