import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "@/web/lib/auth";

function RailIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  jobs: "M4 7h16M4 12h16M4 17h10",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9c1.2-4 4-6 7-6s5.8 2 7 6",
  crawl: "M4 5h16v14H4V5Zm3 4h10v2H7V9Zm0 4h10v2H7v-2Z",
  discovery: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9.5 16.5-4.8-4.8",
};

// Icon-only rail with a label tooltip — not the labeled-sidebar-with-logo
// pattern every dashboard template uses.
function RailItem({ to, end, icon, label }: { to: string; end?: boolean; icon: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `group relative flex h-11 w-11 items-center justify-center rounded-2xl transition-colors ${
          isActive ? "bg-brand text-white" : "text-white/45 hover:bg-white/10 hover:text-white"
        }`
      }
    >
      <RailIcon path={icon} />
      <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <aside className="hidden w-[72px] shrink-0 flex-col items-center gap-1 bg-ink py-4 sm:flex">
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-sm font-extrabold text-white">R</div>

        <RailItem to="/" end icon={ICONS.jobs} label="Jobs" />
        <RailItem to="/profile" icon={ICONS.profile} label="Profile" />

        {user?.role === "admin" && (
          <>
            <div className="my-2 h-px w-6 bg-white/15" />
            <RailItem to="/admin/crawl-health" icon={ICONS.crawl} label="Crawl health" />
            <RailItem to="/admin/discovery" icon={ICONS.discovery} label="Discovery" />
          </>
        )}

        <div className="mt-auto flex flex-col items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
            {user?.email?.[0]?.toUpperCase()}
          </div>
          <button type="button" onClick={() => logout()} className="text-[10px] font-semibold text-white/40 hover:text-white">
            Exit
          </button>
        </div>
      </aside>

      {/* Mobile: a compact top bar instead of the rail */}
      <div className="fixed inset-x-0 top-0 z-10 flex items-center justify-between bg-ink px-4 py-2.5 sm:hidden">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-xs font-extrabold text-white">R</div>
        <nav className="flex gap-1">
          <RailItem to="/" end icon={ICONS.jobs} label="Jobs" />
          <RailItem to="/profile" icon={ICONS.profile} label="Profile" />
          {user?.role === "admin" && (
            <>
              <RailItem to="/admin/crawl-health" icon={ICONS.crawl} label="Crawl" />
              <RailItem to="/admin/discovery" icon={ICONS.discovery} label="Discovery" />
            </>
          )}
        </nav>
        <button type="button" onClick={() => logout()} className="text-[11px] font-semibold text-white/60">
          Exit
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col pt-12 sm:pt-0">{children}</div>
    </div>
  );
}
