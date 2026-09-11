import { and, desc, eq, gt, ilike, notInArray, or } from "drizzle-orm";
import { DigestEmail } from "@/email/templates/DigestEmail";
import { sendEmail } from "@/email/send";
import { db } from "@/db/client";
import { candidateProfiles, companies, digestDeliveries, jobs, userJobActions, users } from "@/db/schema";
import { rankShortlistForUser } from "./rank";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // jobs first seen in the last 24h
const DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // don't resurface anything sent in the last 30 days
const MAX_JOBS_PER_DIGEST = 20;

export interface DigestCandidate {
  jobId: string;
  title: string;
  companyName: string;
  location: string | null;
  jobUrl: string;
  description: string | null;
}

/**
 * Deterministic filter only (no ranking/embeddings yet — that's the
 * semantic-search and LLM-ranking phases). "Matching" here means: open,
 * recently seen, not already dismissed or previously sent to this user,
 * and — if the profile set location/remote preferences — matching one of
 * them. See PRD.md §10 (Phase 5 vs Phase 6/7).
 */
export async function selectDigestJobsForUser(userId: string): Promise<DigestCandidate[]> {
  const [profile] = await db
    .select()
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    .limit(1);
  if (!profile) return [];

  const cutoff = new Date(Date.now() - DEFAULT_WINDOW_MS);
  const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MS);

  const [dismissedRows, recentDeliveries] = await Promise.all([
    db
      .select({ jobId: userJobActions.jobId })
      .from(userJobActions)
      .where(and(eq(userJobActions.userId, userId), eq(userJobActions.action, "dismissed"))),
    db
      .select({ jobIds: digestDeliveries.jobIds })
      .from(digestDeliveries)
      .where(and(eq(digestDeliveries.userId, userId), gt(digestDeliveries.sentAt, dedupCutoff))),
  ]);

  const excluded = new Set<string>([
    ...dismissedRows.map((r) => r.jobId),
    ...recentDeliveries.flatMap((d) => d.jobIds),
  ]);

  const conditions = [eq(jobs.status, "OPEN"), gt(jobs.firstSeenAt, cutoff)];
  if (excluded.size > 0) {
    conditions.push(notInArray(jobs.id, [...excluded]));
  }

  const prefs = profile.preferences ?? {};
  const preferenceConditions = [
    ...(prefs.locations ?? []).map((loc) => ilike(jobs.location, `%${loc}%`)),
    ...(prefs.remoteOk ? [ilike(jobs.workplaceType, "%remote%"), ilike(jobs.location, "%remote%")] : []),
  ];
  if (preferenceConditions.length > 0) {
    conditions.push(or(...preferenceConditions)!);
  }

  const results = await db
    .select({
      jobId: jobs.id,
      title: jobs.title,
      companyName: companies.name,
      location: jobs.location,
      jobUrl: jobs.jobUrl,
      description: jobs.description,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(...conditions))
    .orderBy(desc(jobs.firstSeenAt))
    .limit(MAX_JOBS_PER_DIGEST);

  return results;
}

export interface DigestRunResult {
  userId: string;
  sent: boolean;
  jobCount: number;
  reason?: string;
}

/**
 * Digest v2 (ranked, with "why you're seeing this") when a profile has an
 * embedding and ranking is configured; falls back to v1 (deterministic
 * filter, no explanation) whenever the ranked path can't run — missing
 * profile/embedding, ANTHROPIC_API_KEY unset, or every scored job refused/
 * failed to parse. Never both: ranking already searches the full open,
 * embedded corpus, so a fallback after a *successful* ranked run would
 * just resurface jobs the ranker already saw and didn't rate highly.
 */
export async function runDigestForUser(userId: string, userEmail: string): Promise<DigestRunResult> {
  const [profile] = await db
    .select({ id: candidateProfiles.id })
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    .limit(1);
  if (!profile) return { userId, sent: false, jobCount: 0, reason: "no profile" };

  const ranked = await rankShortlistForUser(userId);
  let jobsForEmail: Array<{
    jobId: string;
    title: string;
    companyName: string;
    location: string | null;
    jobUrl: string;
    description: string | null;
    score?: number;
    reasons?: string[];
  }>;

  if (!ranked.reason && ranked.ranked.length > 0) {
    if (ranked.costUsd !== null) {
      console.log(
        `[digest] ranked ${ranked.scoredCount} jobs for ${userId} (${ranked.cachedCount} cached), ~$${ranked.costUsd.toFixed(4)}`,
      );
    }
    jobsForEmail = ranked.ranked.map((r) => ({
      jobId: r.jobId,
      title: r.title,
      companyName: r.companyName,
      location: r.location,
      jobUrl: r.jobUrl,
      description: r.description,
      score: r.score.score,
      reasons: r.score.reasons,
    }));
  } else {
    const candidates = await selectDigestJobsForUser(userId);
    jobsForEmail = candidates;
  }

  if (jobsForEmail.length === 0) return { userId, sent: false, jobCount: 0, reason: "no new matching jobs" };

  const result = await sendEmail({
    to: userEmail,
    subject: `${jobsForEmail.length} new role${jobsForEmail.length === 1 ? "" : "s"} on Rova`,
    react: DigestEmail({ jobs: jobsForEmail }),
  });

  // Only record a delivery when the email actually went out — if it
  // didn't (e.g. RESEND_API_KEY unset in dev), these jobs must stay
  // eligible for the next run rather than silently falling out of dedup.
  if (result.sent) {
    await db.insert(digestDeliveries).values({
      userId,
      profileId: profile.id,
      channel: "email",
      jobIds: jobsForEmail.map((c) => c.jobId),
    });
  }

  return { userId, sent: result.sent, jobCount: jobsForEmail.length, reason: result.reason };
}

/** One user's failure (bad email address, provider hiccup) must never
 * block the rest of the run — same discipline as the crawler. */
export async function runDigest(): Promise<DigestRunResult[]> {
  const profileOwners = await db
    .select({ userId: candidateProfiles.userId, email: users.email })
    .from(candidateProfiles)
    .innerJoin(users, eq(candidateProfiles.userId, users.id));

  console.log(`[digest] starting run across ${profileOwners.length} profiles`);

  const results: DigestRunResult[] = [];
  for (const { userId, email } of profileOwners) {
    try {
      const result = await runDigestForUser(userId, email);
      results.push(result);
      console.log(`[digest] ${email}: sent=${result.sent} jobs=${result.jobCount} ${result.reason ?? ""}`.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[digest] ${email} failed:`, message);
      results.push({ userId, sent: false, jobCount: 0, reason: message });
    }
  }

  console.log("[digest] run complete");
  return results;
}
