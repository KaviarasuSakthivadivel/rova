import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { ThemeSwitcher } from "@/web/components/ThemeSwitcher";
import { useAuth } from "@/web/lib/auth";

function Icon({ path, className = "h-[18px] w-[18px]" }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Concentric-ring mark, echoing MetaHarn's own icon (light background,
// rings deepening toward the center) — built entirely from --color-brand/
// -dark/-soft, so it re-colors correctly under any of the 7 accent themes
// (ThemeSwitcher), not just violet.
function RovaMark({ className }: { className: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-md bg-brand-soft ${className}`}>
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="var(--color-brand)" />
        <circle cx="12" cy="12" r="4" fill="var(--color-brand-dark)" />
      </svg>
    </div>
  );
}

const ICONS = {
  jobs: "M4 7h16M4 12h16M4 17h10",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9c1.2-4 4-6 7-6s5.8 2 7 6",
  pipeline: "M4 6h5v5H4V6Zm11 0h5v5h-5V6ZM4 15h5v3H4v-3Zm11 0h5v3h-5v-3ZM9 8.5h6M9 16.5h6",
  crawl: "M4 5h16v14H4V5Zm3 4h10v2H7V9Zm0 4h10v2H7v-2Z",
  discovery: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9.5 16.5-4.8-4.8",
  // Sidebar collapse/expand toggle — a panel-with-a-divider glyph, the
  // common convention for this action (VS Code, most IDE-shaped apps).
  // Stays the same glyph in both directions rather than flipping, also
  // matching how such toggles conventionally behave.
  sidebarToggle: "M4 5h16v14H4V5Zm5 0v14",
};

const SIDEBAR_COLLAPSED_KEY = "rova-sidebar-collapsed";

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

// Bordered-box active state (border + soft fill) rather than a plain fill —
// reads more like a distinct selected "tab," not just a tinted row.
function NavItem({ to, end, icon, label, collapsed }: NavItemDef & { collapsed: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${collapsed ? "justify-center px-0" : ""} ${
          isActive ? "border-brand/50 bg-brand-soft text-brand-ink" : "border-transparent text-ink-muted hover:bg-panel-soft hover:text-ink"
        }`
      }
    >
      <Icon path={icon} />
      {!collapsed && label}
    </NavLink>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mt-5 mb-1 px-3 text-[11px] font-bold tracking-wide text-ink-faint uppercase">{children}</p>;
}

function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false; // private browsing / storage disabled — default to expanded
  }
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const mobileItems = user?.role === "admin" ? [...NAV_ITEMS, ...ADMIN_NAV_ITEMS] : NAV_ITEMS;
  const [collapsed, setCollapsed] = useState(getStoredCollapsed);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // private browsing / storage disabled — still applies for this page view
      }
      return next;
    });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <aside
        className={`hidden shrink-0 flex-col border-r border-line bg-rail transition-[width] duration-150 sm:flex ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        <div className={`flex items-center py-5 ${collapsed ? "flex-col gap-2 px-2" : "justify-between px-5"}`}>
          <div className="flex items-center gap-2.5">
            <RovaMark className="h-8 w-8" />
            {!collapsed && <span className="text-base font-extrabold text-ink">Rova</span>}
          </div>
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-panel-soft hover:text-ink"
          >
            <Icon path={ICONS.sidebarToggle} className="h-4 w-4" />
          </button>
        </div>

        <nav className={`flex flex-1 flex-col gap-0.5 overflow-y-auto ${collapsed ? "px-2" : "px-3"}`}>
          {!collapsed && <SectionLabel>Workspace</SectionLabel>}
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed} />
          ))}

          {user?.role === "admin" && (
            <>
              {collapsed ? <div className="my-2 border-t border-line" /> : <SectionLabel>Admin</SectionLabel>}
              {ADMIN_NAV_ITEMS.map((item) => (
                <NavItem key={item.to} {...item} collapsed={collapsed} />
              ))}
            </>
          )}
        </nav>

        {!collapsed && <ThemeSwitcher />}
      </aside>

      {/* Mobile: a compact top bar instead of the sidebar */}
      <div className="fixed inset-x-0 top-0 z-10 flex items-center justify-between border-b border-line bg-rail px-4 py-2.5 sm:hidden">
        <RovaMark className="h-7 w-7" />
        <nav className="flex gap-1">
          {mobileItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex h-8 w-8 items-center justify-center rounded-md border ${
                  isActive ? "border-brand/50 bg-brand-soft text-brand-ink" : "border-transparent text-ink-faint"
                }`
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
        {/* Desktop-only account bar, above just the content column (not the
            sidebar) — the sidebar's own logo stays flush at the true top. */}
        <div className="hidden shrink-0 items-center justify-end gap-2.5 border-b border-line bg-rail px-5 py-2.5 sm:flex">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel-soft text-xs font-bold text-ink-muted">
            {user?.email?.[0]?.toUpperCase()}
          </div>
          <p className="max-w-[220px] truncate text-xs font-semibold text-ink-muted">{user?.email}</p>
          <button type="button" onClick={() => logout()} className="shrink-0 text-xs font-bold text-ink-faint hover:text-ink">
            Exit
          </button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
