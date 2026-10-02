import { sql } from "drizzle-orm";
import { customType, index, integer, numeric, pgTable, text, timestamp, unique, vector } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// 768 dims — chosen so OpenAI (text-embedding-3-small, truncated via its
// `dimensions` API param) and a local Ollama model (nomic-embed-text,
// native 768) are interchangeable behind one schema. See src/embeddings/.
export const EMBEDDING_DIMENSIONS = 768;

// No tsvector column builder in drizzle-orm's pg-core (unlike `vector`,
// which is purpose-built for pgvector) — a thin customType stands in.
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    source: text("source").notNull(), // "greenhouse" | "lever" | "ashby" | "smartrecruiters"
    externalId: text("external_id").notNull(),

    title: text("title").notNull(),
    description: text("description"),
    // Sanitized subset of the original posting markup (headings, lists,
    // emphasis, links) — see sanitizeDescriptionHtml in pipeline/normalize.ts.
    // `description` above stays plain text: it feeds content_hash/embeddings/
    // summarization, none of which should care about formatting-only diffs.
    descriptionHtml: text("description_html"),

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

    // One-sentence, non-marketing summary — see src/pipeline/summarize.ts.
    // Same null-until-generated / nulled-on-content-change lifecycle as
    // embedding (see ingest.ts).
    summary: text("summary"),

    // Postgres-native full-text search, replacing a literal ILIKE phrase
    // match on title/description — that required the exact substring
    // "senior software developer" to appear verbatim, so it missed an
    // otherwise-matching "Senior Software Engineer" post entirely (no
    // partial/word-order/stemmed matching at all). GENERATED ALWAYS AS
    // means Postgres keeps this in sync on every insert/update — no
    // application-side maintenance. Title is weighted 'A' (matches there
    // rank higher) over description's 'B'. STORED (not VIRTUAL) so the
    // GIN index below can actually index it.
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`,
    ),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.source, table.externalId),
    index("idx_jobs_company").on(table.companyId),
    index("idx_jobs_status").on(table.status),
    index("idx_jobs_first_seen").on(table.firstSeenAt),
    index("idx_jobs_search_vector").using("gin", table.searchVector),
    // ivfflat on embedding is added via a raw-SQL migration once Phase 6
    // lands real data to index against — an empty vector index is just
    // overhead (PLAN.md §4).
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
