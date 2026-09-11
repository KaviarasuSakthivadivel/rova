import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, jobs } from "@/db/schema";
import { SummarizationNotConfiguredError, summarizeJob } from "@/summarization";

export interface SummarizeResult {
  summarized: number;
  skipped: boolean;
  reason?: string;
}

/**
 * Its own batch job over jobs missing a summary (nulled out on content
 * change by ingest.ts, same lifecycle as embedding) — decoupled from the
 * crawler/enrichment for the same reason both of those are: a failed or
 * unconfigured summarization provider must never block anything else.
 */
export async function runSummarization(): Promise<SummarizeResult> {
  const pending = await db
    .select({ id: jobs.id, title: jobs.title, description: jobs.description, companyName: companies.name })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(eq(jobs.status, "OPEN"), isNull(jobs.summary)));

  if (pending.length === 0) {
    console.log("[summarize] nothing to summarize");
    return { summarized: 0, skipped: false };
  }

  console.log(`[summarize] summarizing ${pending.length} jobs`);

  let summarized = 0;
  for (const job of pending) {
    let summary: string;
    try {
      summary = await summarizeJob({ title: job.title, companyName: job.companyName, description: job.description });
    } catch (error) {
      if (error instanceof SummarizationNotConfiguredError) {
        console.warn(`[summarize] summarization not available (${error.message}) — skipping`);
        return { summarized, skipped: true, reason: error.message };
      }
      console.error(`[summarize] failed for job ${job.id}:`, error);
      continue;
    }

    if (!summary) continue;
    await db.update(jobs).set({ summary, updatedAt: new Date() }).where(eq(jobs.id, job.id));
    summarized += 1;
    if (summarized % 25 === 0) console.log(`[summarize] summarized ${summarized}/${pending.length}`);
  }

  console.log(`[summarize] done: ${summarized}/${pending.length}`);
  return { summarized, skipped: false };
}
