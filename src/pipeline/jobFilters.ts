import { ilike, not, or, type SQL } from "drizzle-orm";
import { jobs } from "@/db/schema";

// Heuristic, title-based — none of the ATS sources actually crawled today
// (Greenhouse, Ashby) populate a structured seniority field (only Lever
// does, and no tracked company uses Lever), so a seniority filter would be
// permanently empty if it relied on that column. Inferring a bucket from
// the title's own wording makes it usable now; it's approximate by nature
// (a title without any of these words falls into "mid" by default).
export const SENIORITY_BUCKETS = ["intern", "entry", "mid", "senior", "staff", "lead"] as const;
export type SeniorityBucket = (typeof SENIORITY_BUCKETS)[number];

export const SENIORITY_BUCKET_LABELS: Record<SeniorityBucket, string> = {
  intern: "Intern",
  entry: "Entry-level",
  mid: "Mid-level",
  senior: "Senior",
  staff: "Staff/Principal",
  lead: "Lead/Manager",
};

const KEYWORD_PATTERNS: Record<Exclude<SeniorityBucket, "mid">, string[]> = {
  intern: ["%intern%", "%co-op%", "%coop%"],
  entry: ["%junior%", "%jr.%", "%entry level%", "%entry-level%", "%new grad%", "%associate%"],
  senior: ["%senior%", "%sr.%"],
  staff: ["%staff%", "%principal%", "%distinguished%", "%architect%"],
  lead: ["%lead%", "%manager%", "%head of%", "%director%"],
};

// Exported for the facet-count query (one `count(*) FILTER (WHERE ...)`
// per bucket, in a single aggregate query — see GET /api/jobs/facets).
export function bucketCondition(bucket: SeniorityBucket): SQL {
  if (bucket === "mid") {
    // No keyword of its own — "mid" means none of the other buckets'
    // keywords appear in the title.
    const others = Object.values(KEYWORD_PATTERNS)
      .flat()
      .map((pattern) => ilike(jobs.title, pattern));
    return not(or(...others)!);
  }
  return or(...KEYWORD_PATTERNS[bucket].map((pattern) => ilike(jobs.title, pattern)))!;
}

export function buildSeniorityCondition(buckets: string[] | undefined): SQL | undefined {
  const valid = buckets?.filter((b): b is SeniorityBucket => (SENIORITY_BUCKETS as readonly string[]).includes(b));
  if (!valid || valid.length === 0) return undefined;
  return or(...valid.map(bucketCondition))!;
}
