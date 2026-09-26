import { useState } from "react";
import { ACCENT_THEMES, applyAccent, getStoredAccent } from "@/web/lib/theme";

export function ThemeSwitcher() {
  const [active, setActive] = useState(getStoredAccent);

  return (
    <div className="border-t border-line px-5 py-3">
      <p className="mb-2 text-[10px] font-bold tracking-wide text-ink-faint uppercase">Theme</p>
      <div className="flex flex-wrap gap-1.5">
        {ACCENT_THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            title={theme.label}
            aria-label={`${theme.label} theme`}
            aria-pressed={active === theme.id}
            onClick={() => {
              applyAccent(theme.id);
              setActive(theme.id);
            }}
            className={`h-5 w-5 shrink-0 rounded-full transition-transform ${
              active === theme.id ? "scale-110 ring-2 ring-ink ring-offset-2 ring-offset-rail" : "hover:scale-110"
            }`}
            style={{ backgroundColor: theme.swatch }}
          />
        ))}
      </div>
    </div>
  );
}
