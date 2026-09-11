import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "@/auth/middleware";
import { requireAuth } from "@/auth/middleware";
import { db } from "@/db/client";
import { companies, crawlRuns } from "@/db/schema";

// No admin-role system exists yet — every authenticated user can see crawl
// health today. Fine for a single-operator MVP; revisit before any
// multi-tenant/public signup (see PRD.md open questions).

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const adminRoutes = new Hono<AuthEnv>()
  .use(requireAuth)

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
