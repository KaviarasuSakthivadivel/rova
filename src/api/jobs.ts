import { zValidator } from "@hono/zod-validator";
import { and, cosineDistance, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "@/auth/middleware";
import { requireAuth } from "@/auth/middleware";
import { db } from "@/db/client";
import { candidateProfiles, companies, jobs, userJobActions } from "@/db/schema";

const searchQuerySchema = z.object({
  q: z.string().trim().optional(),
  location: z.string().trim().optional(),
  // Deliberately not z.coerce.boolean() — that coerces any non-empty
  // string (including "false") to true.
  semantic: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const actionSchema = z.object({
  action: z.enum(["saved", "dismissed", "applied"]),
});

export const jobsRoutes = new Hono<AuthEnv>()
  .use(requireAuth)

  .get("/", zValidator("query", searchQuerySchema), async (c) => {
    const { q, location, semantic, limit, offset } = c.req.valid("query");
    const user = c.get("user")!;

    if (semantic) {
      const [profileRow] = await db
        .select({ embedding: candidateProfiles.embedding })
        .from(candidateProfiles)
        .where(eq(candidateProfiles.userId, user.id))
        .limit(1);

      if (!profileRow) {
        return c.json({ error: "save a profile first to enable semantic search" }, 400);
      }
      if (!profileRow.embedding) {
        return c.json(
          {
            error:
              "your profile doesn't have an embedding yet — this usually means OPENAI_API_KEY isn't configured on the server, or the last save failed to embed. Check the server logs, then try saving your profile again.",
          },
          400,
        );
      }
      const profileEmbedding = profileRow.embedding;

      // Only enriched jobs (embedding IS NOT NULL) participate — see
      // src/pipeline/enrich.ts. Ranking against profile similarity
      // replaces the keyword filter; `location` still narrows results.
      const conditions = [eq(jobs.status, "OPEN"), isNotNull(jobs.embedding)];
      if (location) conditions.push(ilike(jobs.location, `%${location}%`));

      const distance = cosineDistance(jobs.embedding, profileEmbedding);

      const results = await db
        .select({
          job: jobs,
          companyName: companies.name,
          action: userJobActions.action,
          similarity: sql<number>`1 - (${distance})`,
        })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .leftJoin(userJobActions, and(eq(userJobActions.jobId, jobs.id), eq(userJobActions.userId, user.id)))
        .where(and(...conditions))
        .orderBy(distance)
        .limit(limit)
        .offset(offset);

      return c.json({ jobs: results, limit, offset, mode: "semantic" });
    }

    // Baseline deterministic search — SQL ILIKE only.
    const conditions = [eq(jobs.status, "OPEN")];
    if (q) {
      conditions.push(or(ilike(jobs.title, `%${q}%`), ilike(jobs.description, `%${q}%`))!);
    }
    if (location) {
      conditions.push(ilike(jobs.location, `%${location}%`));
    }

    const results = await db
      .select({
        job: jobs,
        companyName: companies.name,
        action: userJobActions.action,
      })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .leftJoin(userJobActions, and(eq(userJobActions.jobId, jobs.id), eq(userJobActions.userId, user.id)))
      .where(and(...conditions))
      .orderBy(desc(jobs.firstSeenAt))
      .limit(limit)
      .offset(offset);

    return c.json({ jobs: results, limit, offset, mode: "keyword" });
  })

  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user")!;

    const [result] = await db
      .select({ job: jobs, companyName: companies.name, action: userJobActions.action })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .leftJoin(userJobActions, and(eq(userJobActions.jobId, jobs.id), eq(userJobActions.userId, user.id)))
      .where(eq(jobs.id, id))
      .limit(1);

    if (!result) return c.json({ error: "not found" }, 404);
    return c.json(result);
  })

  .post("/:id/action", zValidator("json", actionSchema), async (c) => {
    const jobId = c.req.param("id");
    const user = c.get("user")!;
    const { action } = c.req.valid("json");

    const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return c.json({ error: "not found" }, 404);

    await db
      .insert(userJobActions)
      .values({ userId: user.id, jobId, action })
      .onConflictDoUpdate({
        target: [userJobActions.userId, userJobActions.jobId],
        set: { action, createdAt: new Date() },
      });

    return c.json({ ok: true, action });
  });
