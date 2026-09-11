export type SupportedAts = "greenhouse" | "lever" | "ashby";

export interface HeuristicMatch {
  ats: SupportedAts;
  atsIdentifier: string;
  careersUrl: string;
  confidence: number;
}

const CANDIDATE_PATTERNS: { ats: SupportedAts; urlFor: (slug: string) => string }[] = [
  { ats: "greenhouse", urlFor: (slug) => `https://boards.greenhouse.io/${slug}` },
  { ats: "lever", urlFor: (slug) => `https://jobs.lever.co/${slug}` },
  { ats: "ashby", urlFor: (slug) => `https://jobs.ashbyhq.com/${slug}` },
];

function slugVariants(companyName: string): string[] {
  const base = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim();
  const noSpaces = base.replace(/\s+/g, "");
  const hyphenated = base.replace(/\s+/g, "-");
  return [...new Set([noSpaces, hyphenated])].filter(Boolean);
}

async function urlResolves(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    // Greenhouse/Lever/Ashby board pages 404 cleanly for an unknown slug;
    // anything 2xx/3xx counts as a real hit (some orgs proxy through a
    // custom domain and redirect).
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

/**
 * Cheap, no-LLM pass: try known ATS URL patterns against slugified name
 * variants, confirming each candidate actually resolves before reporting
 * it as a hit — never store an unconfirmed guess as if verified.
 * See PLAN.md Phase 8 — heuristics first, LLM only for ambiguous cases.
 */
export async function discoverViaHeuristics(companyName: string): Promise<HeuristicMatch[]> {
  const slugs = slugVariants(companyName);
  const matches: HeuristicMatch[] = [];

  for (const slug of slugs) {
    for (const pattern of CANDIDATE_PATTERNS) {
      const url = pattern.urlFor(slug);
      if (await urlResolves(url)) {
        matches.push({ ats: pattern.ats, atsIdentifier: slug, careersUrl: url, confidence: 0.9 });
      }
    }
  }

  return matches;
}
