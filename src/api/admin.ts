import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "@/auth/middleware";
import { requireAuth } from "@/auth/middleware";
import { db } from "@/db/client";
import { companies, crawlRuns } from "@/db/schema";
import { runCrawl } from "@/pipeline/crawl";

// No admin-role system exists yet — every authenticated user can see crawl
// health today. Fine for a single-operator MVP; revisit before any
// multi-tenant/public signup (see PRD.md open questions).

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// Module-level, not per-request — a crawl can run for a while and this
// guards against a double-click (or two admins) starting two overlapping
// runs. Resets on process restart, which is fine: worst case after a
// restart is one redundant concurrent crawl, not a stuck "running" state.
let crawlInProgress = false;

export const adminRoutes = new Hono<AuthEnv>()
  .use(requireAuth)

  .post("/crawl", async (c) => {
    if (crawlInProgress) {
      return c.json({ error: "a crawl is already running" }, 409);
    }
    crawlInProgress = true;

    // Fire-and-forget: a full crawl can take a while as the company list
    // grows, and there's no reason to hold the HTTP request open for it —
    // the crawl-runs list (GET /crawl-runs) already shows live progress
    // per company as rows land.
    runCrawl()
      .catch((error) => console.error("[admin] manually triggered crawl failed:", error))
      .finally(() => {
        crawlInProgress = false;
      });

    return c.json({ ok: true, started: true });
  })

  .get("/crawl-runs", zValidator("query", listQuerySchema), async (c) => {
    const { limit } = c.req.valid("query");

    const runs = await db
      .select({
        id: crawlRuns.id,
        companyName: companies.name,
        status: crawlRuns.status,
        startedAt: crawlRuns.startedAt,
        finishedAt: crawlRuns.finishedAt,
        jobsSeen: crawlRuns.jobsSeen,
        jobsAdded: crawlRuns.jobsAdded,
        jobsUpdated: crawlRuns.jobsUpdated,
        jobsClosed: crawlRuns.jobsClosed,
        errorMessage: crawlRuns.errorMessage,
      })
      .from(crawlRuns)
      .innerJoin(companies, eq(crawlRuns.companyId, companies.id))
      .orderBy(desc(crawlRuns.startedAt))
      .limit(limit);

    return c.json({ runs });
  });
