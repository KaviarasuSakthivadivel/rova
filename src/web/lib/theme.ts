// Accent color is the only themeable thing — every other token (bg, ink,
// line, panel) stays fixed. Applied as a data-accent attribute on <html>
// so it can flip a whole page's worth of Tailwind utilities (bg-brand,
// text-brand-ink, ...) via one CSS custom-property override block per
// theme (see styles.css) rather than touching every component.
export interface AccentTheme {
  id: string;
  label: string;
  swatch: string; // for the picker UI itself, not applied anywhere else
}

export const ACCENT_THEMES: AccentTheme[] = [
  { id: "violet", label: "Violet", swatch: "#7c3aed" },
  { id: "cobalt", label: "Cobalt", swatch: "#2563eb" },
  { id: "emerald", label: "Emerald", swatch: "#059669" },
  { id: "amber", label: "Amber", swatch: "#c2410c" },
  { id: "rose", label: "Rose", swatch: "#db2777" },
  { id: "indigo", label: "Indigo", swatch: "#4338ca" },
  { id: "teal", label: "Teal", swatch: "#0f766e" },
];

const DEFAULT_ACCENT = "violet";
const STORAGE_KEY = "rova-accent-theme";
const VALID_IDS = new Set(ACCENT_THEMES.map((t) => t.id));

export function getStoredAccent(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && VALID_IDS.has(stored) ? stored : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT; // private browsing / storage disabled — fall back silently
  }
}

/** Sets the attribute the CSS keys off of, and persists the choice. The
 * "violet" default has no [data-accent="violet"] override block in
 * styles.css — its values already live on bare :root — so this just
 * clears the attribute for that case rather than pointing at a no-op
 * selector. */
export function applyAccent(id: string): void {
  if (id === DEFAULT_ACCENT) {
    document.documentElement.removeAttribute("data-accent");
  } else {
    document.documentElement.setAttribute("data-accent", id);
  }
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing / storage disabled — the theme still applies for
    // this page view, it just won't persist to the next one.
  }
}
