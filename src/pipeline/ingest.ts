import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { jobs, jobSnapshots } from "@/db/schema";
import type { NormalizedJob } from "@/sources/base";
import { contentHash, htmlToText, sanitizeDescriptionHtml } from "./normalize";

export type UpsertResult = "ADDED" | "UPDATED" | "UNCHANGED";

/**
 * Insert new / snapshot-then-update changed / touch last_seen_at on
 * unchanged, keyed off content_hash — not the provider's own timestamps.
 * See PLAN.md Phase 3.
 */
export async function upsertJob(
  db: Database,
  companyId: string,
  source: string,
  incoming: NormalizedJob,
): Promise<UpsertResult> {
  const description = htmlToText(incoming.description);
  const descriptionHtml = sanitizeDescriptionHtml(incoming.description);
  const hash = contentHash(incoming.title, description, incoming.location);
  const now = new Date();

  const [existing] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.source, source), eq(jobs.externalId, incoming.externalId)))
    .limit(1);

  if (!existing) {
    await db.insert(jobs).values({
      companyId,
      source,
      externalId: incoming.externalId,
      title: incoming.title,
      description,
      descriptionHtml,
      location: incoming.location,
      workplaceType: incoming.workplaceType,
      department: incoming.department,
      team: incoming.team,
      employmentType: incoming.employmentType,
      salaryCurrency: incoming.salaryCurrency,
      salaryMin: incoming.salaryMin?.toString(),
      salaryMax: incoming.salaryMax?.toString(),
      salaryInterval: incoming.salaryInterval,
      jobUrl: incoming.jobUrl,
      applyUrl: incoming.applyUrl,
      postedAt: incoming.postedAt,
      sourceUpdatedAt: incoming.sourceUpdatedAt,
      status: "OPEN",
      firstSeenAt: now,
      lastSeenAt: now,
      contentHash: hash,
    });
    return "ADDED";
  }

  const changed = existing.contentHash !== hash;

  if (changed) {
    await db.insert(jobSnapshots).values({
      jobId: existing.id,
      title: existing.title,
      description: existing.description,
      location: existing.location,
      workplaceType: existing.workplaceType,
      salaryMin: existing.salaryMin,
      salaryMax: existing.salaryMax,
      contentHash: existing.contentHash,
    });
  }

  await db
    .update(jobs)
    .set({
      title: incoming.title,
      description,
      descriptionHtml,
      location: incoming.location,
      workplaceType: incoming.workplaceType,
      department: incoming.department,
      team: incoming.team,
      salaryMin: incoming.salaryMin?.toString(),
      salaryMax: incoming.salaryMax?.toString(),
      salaryCurrency: incoming.salaryCurrency,
      jobUrl: incoming.jobUrl,
      applyUrl: incoming.applyUrl,
      sourceUpdatedAt: incoming.sourceUpdatedAt,
      lastSeenAt: now,
      contentHash: hash,
      status: "OPEN",
      updatedAt: now,
      // Content changed, so any existing embedding/summary are now stale —
      // null them out so enrichment/summarization pick this job up again.
      ...(changed ? { embedding: null, summary: null } : {}),
    })
    .where(eq(jobs.id, existing.id));

  return changed ? "UPDATED" : "UNCHANGED";
}
