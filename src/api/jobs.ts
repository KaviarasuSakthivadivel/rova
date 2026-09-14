import { zValidator } from "@hono/zod-validator";
import { and, asc, cosineDistance, desc, eq, gt, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "@/auth/middleware";
import { requireAuth } from "@/auth/middleware";
import { env } from "@/config";
import { db } from "@/db/client";
import { candidateProfiles, companies, jobs, userJobActions } from "@/db/schema";
import { bucketCondition, buildSeniorityCondition, SENIORITY_BUCKETS, type SeniorityBucket } from "@/pipeline/jobFilters";
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
  // In days — "posted within the last N days", using firstSeenAt (see
  // jobs.ts schema comment: the crawler's own change-detection timestamp,
  // not an ATS-provided one, since those aren't trustworthy/consistent
  // across providers).
  postedWithinDays: z.coerce.number().int().positive().optional(),
  // Comma-separated company ids.
  companyIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined)),
  // Comma-separated seniority buckets — see pipeline/jobFilters.ts for the
  // heuristic behind them.
  seniority: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined)),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const actionSchema = z.object({
  action: z.enum(["saved", "dismissed", "applied"]),
});

// Same base-search params as searchQuerySchema, minus companyIds/seniority
// (the two dimensions being faceted over) and minus limit/offset (facets
// aggregate across everything matching, not one page of it).
const facetsQuerySchema = z.object({
  q: z.string().trim().optional(),
  location: z.string().trim().optional(),
  semantic: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  postedWithinDays: z.coerce.number().int().positive().optional(),
});

export const jobsRoutes = new Hono<AuthEnv>()
  .use(requireAuth)

  .get("/", zValidator("query", searchQuerySchema), async (c) => {
    const { q, location, semantic, postedWithinDays, companyIds, seniority, limit, offset } = c.req.valid("query");
    const user = c.get("user")!;
    const postedSince = postedWithinDays ? new Date(Date.now() - postedWithinDays * 24 * 60 * 60 * 1000) : undefined;

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
        const result = await rankSearchResultsForUser(user.id, { location, postedSince, companyIds, seniority });
        const page = result.ranked.slice(offset, offset + limit);
        const pageJobIds = page.map((r) => r.jobId);

        // RankedJob only carries the fields the LLM/email need — fetch
        // full rows (department, workplaceType, firstSeenAt, ...) for the
        // web UI, then merge in the score/reasons by id.
        const fullRows = pageJobIds.length
          ? await db
              .select({ job: jobs, action: userJobActions.action, companyDomain: companies.domain })
              .from(jobs)
              .innerJoin(companies, eq(jobs.companyId, companies.id))
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
                companyDomain: full.companyDomain,
                action: full.action,
                score: r.score.score,
                reasons: r.score.reasons,
              };
            })
            .filter((r) => r !== null),
          limit,
          offset,
          hasMore: offset + limit < result.ranked.length,
          mode: "ranked",
        });
      }

      const conditions = [eq(jobs.status, "OPEN"), isNotNull(jobs.embedding)];
      if (location) conditions.push(ilike(jobs.location, `%${location}%`));
      if (postedSince) conditions.push(gt(jobs.firstSeenAt, postedSince));
      if (companyIds && companyIds.length > 0) conditions.push(inArray(jobs.companyId, companyIds));
      const similaritySeniorityCondition = buildSeniorityCondition(seniority);
      if (similaritySeniorityCondition) conditions.push(similaritySeniorityCondition);

      const distance = cosineDistance(jobs.embedding, profileEmbedding);

      // Fetch one extra row past the page to know whether another page
      // exists without a separate COUNT query — infinite scroll just
      // needs a boolean, not an exact total.
      const results = await db
        .select({
          job: jobs,
          companyName: companies.name,
          companyDomain: companies.domain,
          action: userJobActions.action,
          similarity: sql<number>`1 - (${distance})`,
        })
        .from(jobs)
        .innerJoin(companies, eq(jobs.companyId, companies.id))
        .leftJoin(userJobActions, and(eq(userJobActions.jobId, jobs.id), eq(userJobActions.userId, user.id)))
        .where(and(...conditions))
        .orderBy(distance)
        .limit(limit + 1)
        .offset(offset);

      return c.json({ jobs: results.slice(0, limit), limit, offset, hasMore: results.length > limit, mode: "similarity" });
    }

    // Baseline deterministic search — SQL ILIKE only.
    const conditions = [eq(jobs.status, "OPEN")];
    if (q) {
      conditions.push(or(ilike(jobs.title, `%${q}%`), ilike(jobs.description, `%${q}%`))!);
    }
    if (location) {
      conditions.push(ilike(jobs.location, `%${location}%`));
    }
    if (postedSince) {
      conditions.push(gt(jobs.firstSeenAt, postedSince));
    }
    if (companyIds && companyIds.length > 0) {
      conditions.push(inArray(jobs.companyId, companyIds));
    }
    const keywordSeniorityCondition = buildSeniorityCondition(seniority);
    if (keywordSeniorityCondition) {
      conditions.push(keywordSeniorityCondition);
    }

    const results = await db
      .select({
        job: jobs,
        companyName: companies.name,
        companyDomain: companies.domain,
        action: userJobActions.action,
      })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .leftJoin(userJobActions, and(eq(userJobActions.jobId, jobs.id), eq(userJobActions.userId, user.id)))
      .where(and(...conditions))
      .orderBy(desc(jobs.firstSeenAt))
      .limit(limit + 1)
      .offset(offset);

    return c.json({ jobs: results.slice(0, limit), limit, offset, hasMore: results.length > limit, mode: "keyword" });
  })

  // Registered before "/:id" — these are static paths, but Hono routes
  // are matched in registration order for overlapping patterns and "/:id"
  // would otherwise swallow them.

  // Facet for the company filter — only companies with at least one OPEN
  // job (not the full admin company list, which includes deactivated
  // companies and ones with nothing currently open to filter to).
  .get("/companies", async (c) => {
    const rows = await db
      .select({ id: companies.id, name: companies.name, domain: companies.domain, count: sql<number>`count(*)::int` })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(eq(jobs.status, "OPEN"))
      .groupBy(companies.id, companies.name, companies.domain)
      .orderBy(asc(companies.name));

    return c.json({ companies: rows });
  })

  // Live per-company/per-seniority counts for the filter sidebar, scoped
  // to the same base search (q/location/postedWithinDays/semantic) the
  // main search below actually runs — not a static "total open jobs"
  // count, which goes stale the moment you change the search (e.g. still
  // showing a company's full job count while "Match to me" mode has 0
  // matches for it).
  //
  // Embedding-based modes (similarity/ranked) are both represented here
  // by "does this job have an embedding at all," not a live per-job
  // cosine score — scoring every job against the profile just to build
  // sidebar counts would mean a second full vector pass (and, for ranked
  // mode, doesn't map cleanly onto counts anyway, since only a capped
  // shortlist ever gets LLM-scored). Close proxy, not the exact final
  // ranked count.
  .get("/facets", zValidator("query", facetsQuerySchema), async (c) => {
    const { q, location, semantic, postedWithinDays } = c.req.valid("query");
    const user = c.get("user")!;
    const postedSince = postedWithinDays ? new Date(Date.now() - postedWithinDays * 24 * 60 * 60 * 1000) : undefined;
    const zeroSeniority = Object.fromEntries(SENIORITY_BUCKETS.map((b) => [b, 0])) as Record<SeniorityBucket, number>;

    const searchConditions: SQL[] = [];
    if (semantic) {
      searchConditions.push(isNotNull(jobs.embedding));
      const [profileRow] = await db
        .select({ embedding: candidateProfiles.embedding })
        .from(candidateProfiles)
        .where(eq(candidateProfiles.userId, user.id))
        .limit(1);
      // No profile/embedding means the real search below 400s — the
      // facet sidebar just goes quiet rather than surfacing its own
      // error for what's a secondary, non-critical display.
      if (!profileRow?.embedding) {
        return c.json({ companies: [], seniority: zeroSeniority });
      }
    } else if (q) {
      searchConditions.push(or(ilike(jobs.title, `%${q}%`), ilike(jobs.description, `%${q}%`))!);
    }
    if (location) searchConditions.push(ilike(jobs.location, `%${location}%`));
    if (postedSince) searchConditions.push(gt(jobs.firstSeenAt, postedSince));
    const searchFilter: SQL = searchConditions.length > 0 ? and(...searchConditions)! : sql`true`;

    // Same base universe as GET /companies (every company with at least
    // one OPEN job) — the live count is a FILTER on that same row set,
    // not a second, narrower JOIN, so a company whose count drops to 0
    // under the current search still appears (as 0), rather than
    // disappearing from the list entirely.
    const companyFacets = await db
      .select({
        id: companies.id,
        name: companies.name,
        domain: companies.domain,
        count: sql<number>`count(*) FILTER (WHERE ${searchFilter})::int`,
      })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(eq(jobs.status, "OPEN"))
      .groupBy(companies.id, companies.name, companies.domain)
      .orderBy(asc(companies.name));

    const [seniorityRow] = await db
      .select({
        intern: sql<number>`count(*) FILTER (WHERE ${and(bucketCondition("intern"), searchFilter)})::int`,
        entry: sql<number>`count(*) FILTER (WHERE ${and(bucketCondition("entry"), searchFilter)})::int`,
        mid: sql<number>`count(*) FILTER (WHERE ${and(bucketCondition("mid"), searchFilter)})::int`,
        senior: sql<number>`count(*) FILTER (WHERE ${and(bucketCondition("senior"), searchFilter)})::int`,
        staff: sql<number>`count(*) FILTER (WHERE ${and(bucketCondition("staff"), searchFilter)})::int`,
        lead: sql<number>`count(*) FILTER (WHERE ${and(bucketCondition("lead"), searchFilter)})::int`,
      })
      .from(jobs)
      .where(eq(jobs.status, "OPEN"));

    return c.json({ companies: companyFacets, seniority: seniorityRow ?? zeroSeniority });
  })

  .get("/new-count", async (c) => {
    const user = c.get("user")!;

    const [profileRow] = await db
      .select({ matchesLastViewedAt: candidateProfiles.matchesLastViewedAt, createdAt: candidateProfiles.createdAt })
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, user.id))
      .limit(1);

    if (!profileRow) return c.json({ count: 0, since: null });

    const since = profileRow.matchesLastViewedAt ?? profileRow.createdAt;
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(eq(jobs.status, "OPEN"), gt(jobs.firstSeenAt, since)));

    return c.json({ count: row?.count ?? 0, since: since.toISOString() });
  })

  .post("/mark-seen", async (c) => {
    const user = c.get("user")!;

    await db.update(candidateProfiles).set({ matchesLastViewedAt: new Date() }).where(eq(candidateProfiles.userId, user.id));

    return c.json({ ok: true });
  })

  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const user = c.get("user")!;

    const [result] = await db
      .select({ job: jobs, companyName: companies.name, companyDomain: companies.domain, action: userJobActions.action })
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
