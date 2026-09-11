export type SupportedAts = "greenhouse" | "lever" | "ashby";

export interface HeuristicMatch {
  ats: SupportedAts;
  atsIdentifier: string;
  careersUrl: string;
  confidence: number;
}

const CANDIDATE_PATTERNS: {
  ats: SupportedAts;
  careersUrlFor: (slug: string) => string;
  // The API endpoints the real crawler adapters use (src/sources/*.ts) —
  // these 404 correctly for a nonexistent slug. The human-facing hosted
  // pages do NOT: verified live, Greenhouse 301-redirects and Ashby
  // 200s for a slug that has never existed, which made every heuristic
  // check here a false positive (see git history — this shipped a wrong
  // "Google -> Ashby" match at 0.9 confidence before this fix).
  verifyUrlFor: (slug: string) => string;
}[] = [
  {
    ats: "greenhouse",
    careersUrlFor: (slug) => `https://boards.greenhouse.io/${slug}`,
    verifyUrlFor: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
  },
  {
    ats: "lever",
    careersUrlFor: (slug) => `https://jobs.lever.co/${slug}`,
    verifyUrlFor: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  },
  {
    ats: "ashby",
    careersUrlFor: (slug) => `https://jobs.ashbyhq.com/${slug}`,
    verifyUrlFor: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
  },
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

async function apiConfirms(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Cheap, no-LLM pass: try known ATS URL patterns against slugified name
 * variants, confirming each candidate against the same API endpoint the
 * real crawler adapter would use (src/sources/*.ts) before reporting it
 * as a hit — never store an unconfirmed guess as if verified.
 * See PLAN.md Phase 8 — heuristics first, LLM only for ambiguous cases.
 */
export async function discoverViaHeuristics(companyName: string): Promise<HeuristicMatch[]> {
  const slugs = slugVariants(companyName);
  const matches: HeuristicMatch[] = [];

  for (const slug of slugs) {
    for (const pattern of CANDIDATE_PATTERNS) {
      if (await apiConfirms(pattern.verifyUrlFor(slug))) {
        matches.push({
          ats: pattern.ats,
          atsIdentifier: slug,
          careersUrl: pattern.careersUrlFor(slug),
          confidence: 0.9,
        });
      }
    }
  }

  return matches;
}
