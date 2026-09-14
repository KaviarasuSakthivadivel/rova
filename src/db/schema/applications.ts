import { index, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { jobs } from "./jobs";
import { users } from "./users";

export const applicationStages = ["added", "ready", "applied"] as const;
export type ApplicationStage = (typeof applicationStages)[number];

export const generationStatuses = ["not_started", "generating", "succeeded", "failed"] as const;
export type GenerationStatus = (typeof generationStatuses)[number];

export interface PacketAnswer {
  question: string;
  answer: string;
  // "fetched" = came from the ATS's own application-question schema
  // (Greenhouse only today — see src/applications/questions.ts);
  // "freeform" = the user pasted a question ad hoc and asked for a draft.
  source: "fetched" | "freeform";
}

/**
 * One row per (user, job) tracking that user's application pipeline for
 * that job — Added / Ready / Applied — plus the generated packet content.
 * Same family as userJobActions (saved/dismissed/applied) but needs a
 * richer state model (a packet has real generated content and a
 * generation lifecycle) than that table's single overwritable `action`
 * column can hold. See src/api/applications.ts.
 */
export const applicationPackets = pgTable(
  "application_packets",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),

    // Which Kanban column. Deliberately decoupled from generationStatus
    // below — a failed regeneration on a "ready" packet must not kick the
    // card back to "added" (never wedge/regress the pipeline over a
    // retry-able LLM failure).
    stage: text("stage", { enum: applicationStages }).notNull().default("added"),

    // Lifecycle of the *latest* generation attempt. "Generate Pack…"
    // (stage stays "added" while generating, advances to "ready" only on
    // first success) and "Regenerate pack" (stage already "ready" or
    // "applied", stays put — only content + this field change) are the
    // same state machine.
    generationStatus: text("generation_status", { enum: generationStatuses }).notNull().default("not_started"),
    generationError: text("generation_error"),

    // Plain text — mirrors resume/extract.ts's flattened-plain-text
    // convention; rendered with whitespace-pre-line exactly like
    // JobDetail.tsx already renders job.description. No markdown parser.
    tailoredResumeText: text("tailored_resume_text"),
    coverLetterText: text("cover_letter_text"),
    answers: jsonb("answers").$type<PacketAnswer[]>().notNull().default([]),

    // hash(job.contentHash + profileText + resumeText) — mirrors
    // jobRankings.jobContentHash, but also folds in the profile inputs so
    // editing your profile/resume correctly marks existing packets stale
    // too (jobRankings only tracks the job side of that).
    contentHash: text("content_hash").notNull().default(""),
    generatedAt: timestamp("generated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.userId, table.jobId),
    index("idx_application_packets_user_stage").on(table.userId, table.stage),
  ],
);
