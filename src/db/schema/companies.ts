import { boolean, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * ats/ats_identifier together tell the crawler which JobSource
 * implementation to use and what to pass it — see src/sources/.
 */
export const companies = pgTable(
  "companies",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),

    ats: text("ats").notNull(), // "greenhouse" | "lever" | "ashby"
    atsIdentifier: text("ats_identifier").notNull(),

    careersUrl: text("careers_url"),
    // Company's own domain (e.g. "anthropic.com") — NOT the ATS-hosted
    // careers URL host (boards.greenhouse.io/... etc). Used to fetch a
    // logo via Clearbit's free unauthenticated logo API; null renders as
    // an initials avatar instead. Populated from the discovery LLM's
    // resolved domain when a candidate is approved (src/api/discovery.ts)
    // — never guessed from the ATS slug, which is frequently wrong.
    domain: text("domain"),

    active: boolean("active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.ats, table.atsIdentifier)],
);

/**
 * Phase 8+: AI-assisted company/ATS discovery lands here first —
 * never auto-promoted into `companies` without admin review.
 */
export const companyDiscoveryCandidates = pgTable("company_discovery_candidates", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  domain: text("domain"),
  guessedAts: text("guessed_ats"),
  guessedIdentifier: text("guessed_identifier"),
  confidence: text("confidence"), // stored as text; e.g. "0.82" — refine once Phase 8 is built
  status: text("status").notNull().default("pending"), // "pending" | "approved" | "rejected"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
