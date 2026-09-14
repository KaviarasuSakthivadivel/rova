import { useState } from "react";

const SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  md: "h-11 w-11 text-base",
  lg: "h-16 w-16 text-xl",
};

function guessDomain(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`;
}

type Stage = "clearbit" | "favicon" | "failed";

function srcFor(stage: Stage, domain: string): string {
  return stage === "clearbit" ? `https://logo.clearbit.com/${domain}?size=256` : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
}

/**
 * Two real sources, tried in quality order, plus an initials fallback:
 * 1. Clearbit's logo API — proper square logo assets when available, but
 *    coverage has gotten patchy for smaller/lesser-known companies.
 * 2. Google's favicon service — near-universal coverage; most modern
 *    sites register a real high-res icon (128px+), so this is requested
 *    and displayed at full size too rather than assumed-tiny.
 * 3. An initials square if both image sources fail to load.
 * No rounded/circular framing — shown edge-to-edge in its natural square
 * bounding box (a thin border + white backing plate for definition
 * against Rova's dark UI and so dark-colored marks stay legible), not
 * cropped or reshaped into a shape the trademark owner didn't choose.
 * Domain is the company's resolved domain when known (from the discovery
 * LLM's research), else a same-guess derived from the name.
 */
export function CompanyLogo({ name, domain, size = "md" }: { name: string; domain: string | null; size?: "sm" | "md" | "lg" }) {
  const [stage, setStage] = useState<Stage>("clearbit");
  const sizeClass = SIZE_CLASSES[size];
  const initial = name.trim()[0]?.toUpperCase() ?? "?";
  const resolvedDomain = domain ?? guessDomain(name);

  if (stage === "failed") {
    return (
      <div className={`flex shrink-0 items-center justify-center border border-line bg-panel-soft font-bold text-ink-faint ${sizeClass}`}>
        {initial}
      </div>
    );
  }

  return (
    <div className={`flex shrink-0 items-center justify-center border border-line bg-white p-1.5 ${sizeClass}`}>
      <img key={stage} src={srcFor(stage, resolvedDomain)} alt="" onError={() => setStage(stage === "clearbit" ? "favicon" : "failed")} className="h-full w-full object-contain" />
    </div>
  );
}
