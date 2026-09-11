import { index, integer, numeric, pgTable, text, timestamp, unique, vector } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// OpenAI text-embedding-3-small — see PRD.md §4.
export const EMBEDDING_DIMENSIONS = 1536;

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    source: text("source").notNull(), // "greenhouse" | "lever" | "ashby"
    externalId: text("external_id").notNull(),

    title: text("title").notNull(),
    description: text("description"),

    location: text("location"),
    workplaceType: text("workplace_type"),

    department: text("department"),
    team: text("team"),
    employmentType: text("employment_type"),
    seniority: text("seniority"),

    salaryCurrency: text("salary_currency"),
    salaryMin: numeric("salary_min"),
    salaryMax: numeric("salary_max"),
    salaryInterval: text("salary_interval"),

    jobUrl: text("job_url").notNull(),
    applyUrl: text("apply_url"),

    postedAt: timestamp("posted_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),

    // Change detection is driven by content_hash + first/last_seen_at,
    // not the provider's own timestamps (those aren't trustworthy/consistent
    // across ATS providers) — see PLAN.md Phase 3.
    status: text("status").notNull().default("OPEN"), // "OPEN" | "CLOSED"
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    contentHash: text("content_hash").notNull(),

    // Added/populated by the enrichment stage (Phase 6) — null until then.
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.source, table.externalId),
    index("idx_jobs_company").on(table.companyId),
    index("idx_jobs_status").on(table.status),
    index("idx_jobs_first_seen").on(table.firstSeenAt),
    // Full-text + vector indexes (GIN on tsvector, ivfflat on embedding)
    // are added via a raw-SQL migration once Phase 5/6 land real data to
    // index against — an empty vector index is just overhead (PLAN.md §4).
  ],
);

export const jobSnapshots = pgTable("job_snapshots", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  jobId: text("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),

  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  workplaceType: text("workplace_type"),
  salaryMin: numeric("salary_min"),
  salaryMax: numeric("salary_max"),

  contentHash: text("content_hash").notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export const crawlRuns = pgTable("crawl_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),

  status: text("status").notNull(), // "running" | "success" | "failed"

  jobsSeen: integer("jobs_seen").default(0),
  jobsAdded: integer("jobs_added").default(0),
  jobsUpdated: integer("jobs_updated").default(0),
  jobsClosed: integer("jobs_closed").default(0),

  errorMessage: text("error_message"),
});
