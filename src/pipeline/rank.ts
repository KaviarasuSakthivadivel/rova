import { and, cosineDistance, eq, gt, ilike, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { candidateProfiles, companies, digestDeliveries, jobRankings, jobs, userJobActions } from "@/db/schema";
import { buildPreferredLocationsCondition, buildSeniorityCondition, buildTextSearchCondition, cosineSimilarity } from "@/pipeline/jobFilters";
import { estimateCostUsd, type JobScore, rankJob, RankingNotConfiguredError } from "@/ranking/claude";

const SHORTLIST_SIZE = 100; // SQL filter -> vector top-N, never wider than this
const MAX_LLM_CALLS_PER_DIGEST_RUN = 30; // cost guardrail, PRD.md §5/§10
const MAX_LLM_CALLS_PER_SEARCH = 20; // smaller cap — this one blocks an HTTP response
const TOP_N_DIGEST_RESULTS = 10;
const DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface RankedJob {
  jobId: string;
  title: string;
  companyName: string;
  location: string | null;
  jobUrl: string;
  description: string | null;
  score: JobScore;
}

interface ScoreCandidate {
  jobId: string;
  title: string;
  companyName: string;
  location: string | null;
  jobUrl: string;
  description: string | null;
  contentHash: string;
}

interface ScoreCandidatesResult {
  scored: RankedJob[]; // unsorted, unsliced — cached hits + newly-scored
  scoredCount: number;
  cachedCount: number;
  costUsd: number | null;
  notConfigured?: string; // set if RankingNotConfiguredError was hit (message)
}

/**
 * The shared core behind both digest ranking and live "match to my
 * profile" search: cache by (profile, job, content_hash) so an unchanged
 * job already scored for this profile is never re-scored, hard cap on LLM
 * calls per call regardless of candidate-list size. Callers build the
 * candidate list differently (digest excludes dismissed/recently-sent
 * jobs; search doesn't), everything after that is identical.
 */
async function scoreCandidatesWithCache(
  profileId: string,
  profileText: string,
  candidates: ScoreCandidate[],
  maxLlmCalls: number,
): Promise<ScoreCandidatesResult> {
  if (candidates.length === 0) {
    return { scored: [], scoredCount: 0, cachedCount: 0, costUsd: 0 };
  }

  const jobIds = candidates.map((c) => c.jobId);
  const cachedRows = await db
    .select()
    .from(jobRankings)
    .where(and(eq(jobRankings.profileId, profileId), inArray(jobRankings.jobId, jobIds)));
  const cacheByJobId = new Map(cachedRows.map((r) => [r.jobId, r]));

  const scored: RankedJob[] = [];
  let scoredCount = 0;
  let cachedCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const job of candidates) {
    const cached = cacheByJobId.get(job.jobId);
    if (cached && cached.jobContentHash === job.contentHash) {
      cachedCount += 1;
      scored.push({
        jobId: job.jobId,
        title: job.title,
        companyName: job.companyName,
        location: job.location,
        jobUrl: job.jobUrl,
        description: job.description,
        score: {
          score: cached.score,
          strongMatches: cached.strongMatches,
          missingRequirements: cached.missingRequirements,
          reasons: cached.reasons,
        },
      });
      continue;
    }

    if (scoredCount >= maxLlmCalls) continue; // cap hit — leave the rest unscored this call

    let rankResult: Awaited<ReturnType<typeof rankJob>>;
    try {
      rankResult = await rankJob({
        profileText,
        jobTitle: job.title,
        companyName: job.companyName,
        location: job.location,
        description: job.description,
      });
    } catch (error) {
      if (error instanceof RankingNotConfiguredError) {
        return { scored, scoredCount, cachedCount, costUsd: null, notConfigured: error.message };
      }
      console.error(`[rank] scoring failed for job ${job.jobId}:`, error);
      continue;
    }

    scoredCount += 1;
    totalInputTokens += rankResult.inputTokens;
    totalOutputTokens += rankResult.outputTokens;
    if (!rankResult.score) continue; // refusal / unparseable — skip, don't crash the caller

    await db
      .insert(jobRankings)
      .values({
        profileId,
        jobId: job.jobId,
        jobContentHash: job.contentHash,
        score: rankResult.score.score,
        strongMatches: rankResult.score.strongMatches,
        missingRequirements: rankResult.score.missingRequirements,
        reasons: rankResult.score.reasons,
        scoredAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [jobRankings.profileId, jobRankings.jobId],
        set: {
          jobContentHash: job.contentHash,
          score: rankResult.score.score,
          strongMatches: rankResult.score.strongMatches,
          missingRequirements: rankResult.score.missingRequirements,
          reasons: rankResult.score.reasons,
          scoredAt: new Date(),
        },
      });

    scored.push({
      jobId: job.jobId,
      title: job.title,
      companyName: job.companyName,
      location: job.location,
      jobUrl: job.jobUrl,
      description: job.description,
      score: rankResult.score,
    });
  }

  return {
    scored,
    scoredCount,
    cachedCount,
    costUsd: scoredCount > 0 ? estimateCostUsd(totalInputTokens, totalOutputTokens) : 0,
  };
}

export interface SearchFilters {
  q?: string;
  location?: string;
  postedSince?: Date;
  companyIds?: string[];
  seniority?: string[];
  // Fallback OR-matched locations, applied only when `location` above is
  // absent — see buildPreferredLocationsCondition's own comment. Merged
  // in from the profile's preferences by rankShortlistForUser/
  // rankSearchResultsForUser below, not meant to be set directly by a
  // caller that already has an explicit `location`.
  preferredLocations?: string[];
}

async function vectorShortlist(profileEmbedding: number[], extraExclusions: Set<string>, filters: SearchFilters = {}): Promise<ScoreCandidate[]> {
  const { q, location, postedSince, companyIds, seniority, preferredLocations } = filters;
  const conditions = [eq(jobs.status, "OPEN"), isNotNull(jobs.embedding)];
  if (extraExclusions.size > 0) conditions.push(notInArray(jobs.id, [...extraExclusions]));
  if (location) {
    conditions.push(ilike(jobs.location, `%${location}%`));
  } else {
    const preferredLocationsCondition = buildPreferredLocationsCondition(preferredLocations);
    if (preferredLocationsCondition) conditions.push(preferredLocationsCondition);
  }
  if (postedSince) conditions.push(gt(jobs.firstSeenAt, postedSince));
  if (companyIds && companyIds.length > 0) conditions.push(inArray(jobs.companyId, companyIds));
  const seniorityCondition = buildSeniorityCondition(seniority);
  if (seniorityCondition) conditions.push(seniorityCondition);

  // A typed query narrows the shortlist BEFORE cosine-similarity ordering
  // and LLM scoring, rather than being ignored — see api/jobs.ts's own
  // comment on the same fix for "Match to me" mode.
  const textCondition = buildTextSearchCondition(q);

  if (textCondition) {
    // Ranked in JS, not via pgvector's `<=>` in SQL — see
    // cosineSimilarity's own comment in jobFilters.ts for why: Bun's SQL
    // driver silently returns zero rows for a query combining a
    // vector-typed ORDER BY with a websearch_to_tsquery(...) call
    // anywhere in it.
    const rows = await db
      .select({
        jobId: jobs.id,
        title: jobs.title,
        companyName: companies.name,
        location: jobs.location,
        jobUrl: jobs.jobUrl,
        description: jobs.description,
        contentHash: jobs.contentHash,
        embedding: jobs.embedding,
      })
      .from(jobs)
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(and(...conditions, textCondition));

    return rows
      .map(({ embedding, ...candidate }) => ({ candidate, similarity: cosineSimilarity(profileEmbedding, embedding!) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, SHORTLIST_SIZE)
      .map((r) => r.candidate);
  }

  const distance = cosineDistance(jobs.embedding, profileEmbedding);
  return db
    .select({
      jobId: jobs.id,
      title: jobs.title,
      companyName: companies.name,
      location: jobs.location,
      jobUrl: jobs.jobUrl,
      description: jobs.description,
      contentHash: jobs.contentHash,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(...conditions))
    .orderBy(distance)
    .limit(SHORTLIST_SIZE);
}

export interface RankShortlistResult {
  ranked: RankedJob[];
  scoredCount: number; // LLM calls actually made this run (0 if everything was cached)
  cachedCount: number;
  costUsd: number | null;
  reason?: string; // set when ranked is [] because of a config/data gap, not "no good matches"
}

/**
 * SQL filter -> vector top-N -> LLM scores only that shortlist (never the
 * full corpus). Used by the digest: excludes jobs already dismissed or
 * sent in a recent digest, since resurfacing those isn't useful there.
 * See PRD.md §5.
 */
export async function rankShortlistForUser(userId: string): Promise<RankShortlistResult> {
  const empty = (reason: string): RankShortlistResult => ({
    ranked: [],
    scoredCount: 0,
    cachedCount: 0,
    costUsd: null,
    reason,
  });

  const [profile] = await db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId)).limit(1);
  if (!profile) return empty("no profile");
  if (!profile.embedding) return empty("profile has no embedding yet");

  const dismissedRows = await db
    .select({ jobId: userJobActions.jobId })
    .from(userJobActions)
    .where(and(eq(userJobActions.userId, userId), eq(userJobActions.action, "dismissed")));
  const recentDeliveries = await db
    .select({ jobIds: digestDeliveries.jobIds })
    .from(digestDeliveries)
    .where(and(eq(digestDeliveries.userId, userId), gt(digestDeliveries.sentAt, new Date(Date.now() - DEDUP_WINDOW_MS))));
  const excluded = new Set<string>([...dismissedRows.map((r) => r.jobId), ...recentDeliveries.flatMap((d) => d.jobIds)]);

  // The digest has no request-level filters of its own to merge against —
  // it always runs against the profile's own stated preferences.
  const shortlist = await vectorShortlist(profile.embedding, excluded, {
    seniority: profile.preferences.seniority,
    preferredLocations: profile.preferences.locations,
  });
  if (shortlist.length === 0) return empty("no jobs in the vector shortlist");

  const result = await scoreCandidatesWithCache(profile.id, profile.profileText, shortlist, MAX_LLM_CALLS_PER_DIGEST_RUN);
  if (result.notConfigured) return empty(result.notConfigured);

  const ranked = [...result.scored].sort((a, b) => b.score.score - a.score.score).slice(0, TOP_N_DIGEST_RESULTS);
  return { ranked, scoredCount: result.scoredCount, cachedCount: result.cachedCount, costUsd: result.costUsd };
}

export interface RankSearchResult {
  ranked: RankedJob[];
  scoredCount: number;
  cachedCount: number;
  reason?: string;
}

/**
 * Same vector-shortlist + cached-LLM-scoring core as the digest, but for
 * the live "match to my profile" search: no dismissed/recently-sent
 * exclusions (browsing is a different intent than "what's new today"),
 * smaller LLM-call cap (this blocks an HTTP response, not a background
 * job), and returns everything scored rather than trimming to a top-N —
 * the caller applies its own limit/offset.
 */
export async function rankSearchResultsForUser(userId: string, filters: SearchFilters = {}): Promise<RankSearchResult> {
  const empty = (reason: string): RankSearchResult => ({ ranked: [], scoredCount: 0, cachedCount: 0, reason });

  const [profile] = await db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId)).limit(1);
  if (!profile) return empty("no profile");
  if (!profile.embedding) return empty("profile has no embedding yet");

  // Falls back to the profile's own stated preferences wherever the
  // caller's request didn't specify something more specific — e.g. no
  // location typed into the search bar this time, but the profile has
  // preferred locations saved; no seniority bucket checked, but the
  // profile has a preferred seniority. An explicit request-level value
  // always wins over the profile default.
  const effectiveFilters: SearchFilters = {
    ...filters,
    seniority: filters.seniority && filters.seniority.length > 0 ? filters.seniority : profile.preferences.seniority,
    preferredLocations: filters.location ? undefined : profile.preferences.locations,
  };

  const shortlist = await vectorShortlist(profile.embedding, new Set(), effectiveFilters);
  if (shortlist.length === 0) return empty("no jobs in the vector shortlist");

  const result = await scoreCandidatesWithCache(profile.id, profile.profileText, shortlist, MAX_LLM_CALLS_PER_SEARCH);
  if (result.notConfigured) return empty(result.notConfigured);

  const ranked = [...result.scored].sort((a, b) => b.score.score - a.score.score);
  return { ranked, scoredCount: result.scoredCount, cachedCount: result.cachedCount };
}
