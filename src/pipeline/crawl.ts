import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, crawlRuns, jobs } from "@/db/schema";
import { AshbySource } from "@/sources/ashby";
import type { JobSource } from "@/sources/base";
import { GreenhouseSource } from "@/sources/greenhouse";
import { LeverSource } from "@/sources/lever";
import { upsertJob } from "./ingest";

type Company = typeof companies.$inferSelect;

function sourceFor(company: Company): JobSource {
  switch (company.ats) {
    case "greenhouse":
      return new GreenhouseSource(company.atsIdentifier);
    case "lever":
      return new LeverSource(company.atsIdentifier);
    case "ashby":
      return new AshbySource(company.atsIdentifier);
    default:
      throw new Error(`Unsupported ATS "${company.ats}" for company "${company.name}"`);
  }
}

async function crawlCompany(company: Company) {
  const [run] = await db
    .insert(crawlRuns)
    .values({ companyId: company.id, status: "running" })
    .returning();
  if (!run) throw new Error("failed to create crawl_runs row");

  const counts = { seen: 0, added: 0, updated: 0, closed: 0 };

  try {
    const source = sourceFor(company);
    const fetched = await source.fetchJobs();
    const seenExternalIds: string[] = [];

    for (const job of fetched) {
      const result = await upsertJob(db, company.id, source.source, job);
      counts.seen += 1;
      if (result === "ADDED") counts.added += 1;
      if (result === "UPDATED") counts.updated += 1;
      seenExternalIds.push(job.externalId);
    }

    // Anything OPEN for this company/source that wasn't seen this run has
    // disappeared from the board — mark it CLOSED. See PLAN.md Phase 3.
    if (seenExternalIds.length > 0) {
      const closedRows = await db
        .update(jobs)
        .set({ status: "CLOSED", closedAt: new Date() })
        .where(
          and(
            eq(jobs.companyId, company.id),
            eq(jobs.source, source.source),
            eq(jobs.status, "OPEN"),
            notInArray(jobs.externalId, seenExternalIds),
          ),
        )
        .returning({ id: jobs.id });
      counts.closed = closedRows.length;
    }

    await db
      .update(crawlRuns)
      .set({
        status: "success",
        finishedAt: new Date(),
        jobsSeen: counts.seen,
        jobsAdded: counts.added,
        jobsUpdated: counts.updated,
        jobsClosed: counts.closed,
      })
      .where(eq(crawlRuns.id, run.id));

    console.log(
      `[crawl] ${company.name}: seen=${counts.seen} added=${counts.added} updated=${counts.updated} closed=${counts.closed}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(crawlRuns)
      .set({ status: "failed", finishedAt: new Date(), errorMessage: message })
      .where(eq(crawlRuns.id, run.id));
    console.error(`[crawl] ${company.name} failed:`, message);
  }
}

/**
 * One company's failure must never abort the run for the rest —
 * see PLAN.md Phase 3 exit criteria.
 */
export async function runCrawl() {
  const activeCompanies = await db.select().from(companies).where(eq(companies.active, true));
  console.log(`[crawl] starting run across ${activeCompanies.length} companies`);

  for (const company of activeCompanies) {
    await crawlCompany(company);
  }

  console.log("[crawl] run complete");
}
