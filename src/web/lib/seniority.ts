// Mirrors src/pipeline/jobFilters.ts's bucket list — duplicated rather
// than imported because that module pulls in server-only deps (drizzle,
// the db schema). Keep the bucket keys in sync with that file.
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
