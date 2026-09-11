import { and, cosineDistance, eq, gt, inArray, isNotNull, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { candidateProfiles, companies, digestDeliveries, jobRankings, jobs, userJobActions } from "@/db/schema";
import { estimateCostUsd, type JobScore, rankJob, RankingNotConfiguredError } from "@/ranking/claude";

const SHORTLIST_SIZE = 100; // SQL filter -> vector top-N, never wider than this
const MAX_LLM_CALLS_PER_RUN = 30; // hard cap regardless of shortlist size — cost guardrail, PRD.md §5/§10
const TOP_N_RESULTS = 10;
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

export interface RankShortlistResult {
  ranked: RankedJob[];
  scoredCount: number; // LLM calls actually made this run (0 if everything was cached)
  cachedCount: number;
  costUsd: number | null;
  reason?: string; // set when ranked is [] because of a config/data gap, not "no good matches"
}

/**
 * SQL filter -> vector top-N -> LLM scores only that shortlist (never the
 * full corpus) -> cached by (profile, job, content_hash) so an unchanged
 * job already scored for this profile is never re-scored -> hard cap on
 * LLM calls this run regardless of shortlist size. See PRD.md §5.
 */
export async function rankShortlistForUser(userId: string): Promise<RankShortlistResult> {
  const empty = (reason: string): RankShortlistResult => ({
    ranked: [],
    scoredCount: 0,
    cachedCount: 0,
    costUsd: null,
    reason,
  });

  const [profile] = await db
    .select()
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    .limit(1);
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

  const conditions = [eq(jobs.status, "OPEN"), isNotNull(jobs.embedding)];
  if (excluded.size > 0) conditions.push(notInArray(jobs.id, [...excluded]));

  const distance = cosineDistance(jobs.embedding, profile.embedding);
  const shortlist = await db
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

  if (shortlist.length === 0) return empty("no jobs in the vector shortlist");

  const jobIds = shortlist.map((j) => j.jobId);
  const cachedRows = await db
    .select()
    .from(jobRankings)
    .where(and(eq(jobRankings.profileId, profile.id), inArray(jobRankings.jobId, jobIds)));
  const cacheByJobId = new Map(cachedRows.map((r) => [r.jobId, r]));

  const results: RankedJob[] = [];
  let scoredCount = 0;
  let cachedCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const job of shortlist) {
    const cached = cacheByJobId.get(job.jobId);
    if (cached && cached.jobContentHash === job.contentHash) {
      cachedCount += 1;
      results.push({
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

    if (scoredCount >= MAX_LLM_CALLS_PER_RUN) continue; // cap hit — leave the rest unscored this run

    let rankResult: Awaited<ReturnType<typeof rankJob>>;
    try {
      rankResult = await rankJob({
        profileText: profile.profileText,
        jobTitle: job.title,
        companyName: job.companyName,
        location: job.location,
        description: job.description,
      });
    } catch (error) {
      if (error instanceof RankingNotConfiguredError) return empty(error.message);
      console.error(`[rank] scoring failed for job ${job.jobId}:`, error);
      continue;
    }

    scoredCount += 1;
    totalInputTokens += rankResult.inputTokens;
    totalOutputTokens += rankResult.outputTokens;
    if (!rankResult.score) continue; // refusal / unparseable — skip, don't crash the run

    await db
      .insert(jobRankings)
      .values({
        profileId: profile.id,
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

    results.push({
      jobId: job.jobId,
      title: job.title,
      companyName: job.companyName,
      location: job.location,
      jobUrl: job.jobUrl,
      description: job.description,
      score: rankResult.score,
    });
  }

  results.sort((a, b) => b.score.score - a.score.score);

  return {
    ranked: results.slice(0, TOP_N_RESULTS),
    scoredCount,
    cachedCount,
    costUsd: scoredCount > 0 ? estimateCostUsd(totalInputTokens, totalOutputTokens) : 0,
  };
}
