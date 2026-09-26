import { ilike, not, or, sql, type SQL } from "drizzle-orm";
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

// Postgres full-text search against jobs.search_vector (a generated
// tsvector — title weighted over description, see db/schema/jobs.ts),
// replacing a literal ILIKE phrase match. That required the exact
// substring "senior software developer" to appear verbatim in title or
// description, so it silently missed an otherwise-matching "Senior
// Software Engineer" post — no partial-word, word-order, or stemmed
// matching at all. websearch_to_tsquery parses free text the way a
// search box user actually types it (bare words AND together after
// stemming, plus "quoted phrases", OR, and -exclusions) rather than
// requiring strict query syntax the way to_tsquery does.
export function buildTextSearchCondition(q: string | undefined): SQL | undefined {
  if (!q?.trim()) return undefined;
  return sql`${jobs.searchVector} @@ websearch_to_tsquery('english', ${q})`;
}

// Relevance score for ORDER BY — title matches outrank description-only
// matches (see the 'A'/'B' weights on search_vector itself).
export function textSearchRank(q: string): SQL<number> {
  return sql<number>`ts_rank(${jobs.searchVector}, websearch_to_tsquery('english', ${q}))`;
}

// JS-side cosine similarity — used instead of pgvector's `<=>` operator
// specifically when a full-text query is also present. Bun's SQL driver
// has a bug (confirmed via raw psql that Postgres itself has no issue)
// combining a vector-typed ORDER BY expression with a
// websearch_to_tsquery(...) call in the same query — it silently returns
// zero rows rather than erroring. Reproduced even with the tsquery
// nested in a subquery, and separately with a large plain `id IN (...)`
// list alongside vector ordering, so this isn't narrowly about tsquery —
// ranking in JS sidesteps the whole category by never sending Postgres a
// query that combines vector-typed ORDER BY with much else. Trivial cost
// at this corpus's size (a few hundred 768-dim vectors).
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
