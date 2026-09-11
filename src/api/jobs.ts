import { zValidator } from "@hono/zod-validator";
import { and, cosineDistance, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "@/auth/middleware";
import { requireAuth } from "@/auth/middleware";
import { env } from "@/config";
import { db } from "@/db/client";
import { candidateProfiles, companies, jobs, userJobActions } from "@/db/schema";
import { rankSearchResultsForUser } from "@/pipeline/rank";

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
              "your profile doesn't have an embedding yet — this usually means no embeddings provider is configured on the server (OPENAI_API_KEY or a local Ollama), or the last save failed to embed. Check the server logs, then try saving your profile again.",
          },
          400,
        );
      }
      const profileEmbedding = profileRow.embedding;

      // With Claude configured: rank the vector shortlist for a real,
      // calibrated fit score + "why" reasons (same pipeline the digest
      // uses — cached per (profile, job, content_hash), so repeat
      // searches are instant and free). Raw cosine similarity between two
      // "professional experience" embeddings compresses into a narrow,
      // poorly-discriminating band (observed: ~57-74% across a real
      // corpus, with an unrelated finance role scoring almost as high as
      // the best engineering match) — it's fine as an internal shortlist
      // filter, but showing it directly as an absolute "% match" is
      // misleading. Without a key, fall back to it anyway (better than
      // nothing) but label it honestly as similarity, not a match score.
      if (env.ANTHROPIC_API_KEY) {
        const result = await rankSearchResultsForUser(user.id, location);
        const page = result.ranked.slice(offset, offset + limit);
        const pageJobIds = page.map((r) => r.jobId);

        // RankedJob only carries the fields the LLM/email need — fetch
        // full rows (department, workplaceType, firstSeenAt, ...) for the
        // web UI, then merge in the score/reasons by id.
        const fullRows = pageJobIds.length
          ? await db
              .select({ job: jobs, action: userJobActions.action })
              .from(jobs)
              .leftJoin(userJobActions, and(eq(userJobActions.jobId, jobs.id), eq(userJobActions.userId, user.id)))
              .where(inArray(jobs.id, pageJobIds))
          : [];
        const fullRowById = new Map(fullRows.map((r) => [r.job.id, r]));

        return c.json({
          jobs: page
            .map((r) => {
              const full = fullRowById.get(r.jobId);
              if (!full) return null;
              return {
                job: full.job,
                companyName: r.companyName,
                action: full.action,
                score: r.score.score,
                reasons: r.score.reasons,
              };
            })
            .filter((r) => r !== null),
          limit,
          offset,
          mode: "ranked",
        });
      }

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

      return c.json({ jobs: results, limit, offset, mode: "similarity" });
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
