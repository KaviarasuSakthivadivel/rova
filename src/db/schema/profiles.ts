import { index, jsonb, pgTable, text, timestamp, unique, vector } from "drizzle-orm/pg-core";
import { users } from "./users";
import { EMBEDDING_DIMENSIONS, jobs } from "./jobs";

export interface CandidatePreferences {
  locations?: string[];
  remoteOk?: boolean;
  seniority?: string[];
  compFloor?: number;
}

export const candidateProfiles = pgTable("candidate_profiles", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  profileText: text("profile_text").notNull(),
  // Extracted from an uploaded resume (PDF/txt) — see src/api/profile.ts
  // POST /resume. Optional: a profile is usable with just profileText.
  resumeText: text("resume_text"),
  preferences: jsonb("preferences").$type<CandidatePreferences>().notNull().default({}),

  // Populated whenever profileText/resumeText change — see PRD.md §4
  // (embed-on-save). Embeds profileText + resumeText combined.
  embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),

  // Null until the user first opens the Dashboard — see GET
  // /api/jobs/new-count, which falls back to createdAt below so a brand
  // new profile doesn't flag every historical job as NEW.
  matchesLastViewedAt: timestamp("matches_last_viewed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userJobActions = pgTable(
  "user_job_actions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    // One row per (user, job) — a job is either currently saved, dismissed,
    // or neither; setting a new action replaces the previous one (upsert).
    action: text("action").notNull(), // "saved" | "dismissed" | "applied"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.userId, table.jobId), index("idx_user_job_actions_user").on(table.userId)],
);

export const digestDeliveries = pgTable("digest_deliveries", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  profileId: text("profile_id")
    .notNull()
    .references(() => candidateProfiles.id, { onDelete: "cascade" }),

  channel: text("channel").notNull(), // "email" | "slack"
  jobIds: jsonb("job_ids").$type<string[]>().notNull().default([]),

  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});
