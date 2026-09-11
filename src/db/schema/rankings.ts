import { integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { candidateProfiles } from "./profiles";
import { jobs } from "./jobs";

/**
 * Claude's score for one (profile, job) pair. Cached by
 * (profileId, jobId, jobContentHash) so an unchanged job is never
 * re-scored for a profile that's already seen it — the cost guardrail
 * from PRD.md §5/§10 (Phase 7).
 */
export const jobRankings = pgTable(
  "job_rankings",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    profileId: text("profile_id")
      .notNull()
      .references(() => candidateProfiles.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    jobContentHash: text("job_content_hash").notNull(),

    score: integer("score").notNull(), // 0-100
    strongMatches: jsonb("strong_matches").$type<string[]>().notNull().default([]),
    missingRequirements: jsonb("missing_requirements").$type<string[]>().notNull().default([]),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),

    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.profileId, table.jobId)],
);
