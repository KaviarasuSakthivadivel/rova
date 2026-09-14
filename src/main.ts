#!/usr/bin/env bun

// Must run before any command branch below — several of them (not just
// `serve`) make LLM calls that go through logGeneration().
import { flushObservability } from "@/observability/instrumentation";

const [command, ...rest] = Bun.argv.slice(2);

// Every command branch below exits explicitly (rather than letting main()
// return and fall off the end) since a lingering DB connection pool would
// otherwise keep the process alive — routing all of those through this
// gives logGeneration()'s pending spans a chance to actually reach
// Langfuse first, which a bare process.exit() would otherwise cut off
// mid-flight.
async function exitAfterFlush(code: number): Promise<never> {
  await flushObservability();
  process.exit(code);
}

async function main() {
  switch (command) {
    case "serve": {
      const { serve } = await import("@/server");
      serve();
      break;
    }

    case "worker": {
      const { startWorker } = await import("@/worker");
      startWorker();
      break;
    }

    case "migrate": {
      const { runMigrations } = await import("@/db/migrate");
      await runMigrations();
      await exitAfterFlush(0);
      break;
    }

    case "seed": {
      const { seedCompanies } = await import("@/pipeline/seed");
      const csvPath = rest[0] ?? "./scripts/companies.seed.csv";
      await seedCompanies(csvPath);
      await exitAfterFlush(0);
      break;
    }

    case "crawl": {
      const { runCrawl } = await import("@/pipeline/crawl");
      await runCrawl();
      await exitAfterFlush(0);
      break;
    }

    case "digest": {
      const { runDigest } = await import("@/pipeline/digest");
      await runDigest();
      await exitAfterFlush(0);
      break;
    }

    case "enrich": {
      const { runEnrichment } = await import("@/pipeline/enrich");
      await runEnrichment();
      await exitAfterFlush(0);
      break;
    }

    case "summarize": {
      const { runSummarization } = await import("@/pipeline/summarize");
      await runSummarization();
      await exitAfterFlush(0);
      break;
    }

    case "rank": {
      // Manual/debug entrypoint: scores every profile's shortlist and
      // warms the job_rankings cache without sending anything — the
      // scheduled digest run does the same ranking inline (see
      // src/pipeline/digest.ts), this just lets you pre-warm or inspect
      // ranking output separately.
      const { db } = await import("@/db/client");
      const { candidateProfiles, users } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");
      const { rankShortlistForUser } = await import("@/pipeline/rank");

      const profileOwners = await db
        .select({ userId: candidateProfiles.userId, email: users.email })
        .from(candidateProfiles)
        .innerJoin(users, eq(candidateProfiles.userId, users.id));

      console.log(`[rank] scoring shortlists for ${profileOwners.length} profiles`);
      for (const { userId, email } of profileOwners) {
        const result = await rankShortlistForUser(userId);
        const cost = result.costUsd !== null ? `~$${result.costUsd.toFixed(4)}` : "n/a";
        console.log(
          `[rank] ${email}: ranked=${result.ranked.length} scored=${result.scoredCount} cached=${result.cachedCount} cost=${cost} ${result.reason ?? ""}`.trim(),
        );
      }
      await exitAfterFlush(0);
      break;
    }

    case "make-admin": {
      const email = rest[0];
      if (!email) {
        console.error("Usage: rova make-admin <email>");
        await exitAfterFlush(1);
        return;
      }
      const { db } = await import("@/db/client");
      const { users } = await import("@/db/schema");
      const { eq } = await import("drizzle-orm");

      const [user] = await db
        .update(users)
        .set({ role: "admin" })
        .where(eq(users.email, email))
        .returning({ id: users.id, email: users.email });

      if (!user) {
        console.error(`No user found with email "${email}"`);
        await exitAfterFlush(1);
        return;
      }
      console.log(`[make-admin] ${user.email} is now an admin`);
      await exitAfterFlush(0);
      break;
    }

    case "discover": {
      if (rest.length === 0) {
        console.error('Usage: rova discover "Company One" "Company Two" ...');
        await exitAfterFlush(1);
      }
      const { runDiscovery } = await import("@/pipeline/discover");
      const results = await runDiscovery(rest);
      for (const r of results) {
        console.log(`[discover] ${r.companyName}: matched=${r.matched} source=${r.source} ${r.reason ?? ""}`.trim());
      }
      await exitAfterFlush(0);
      break;
    }

    default: {
      console.log(
        [
          "Usage: rova <command>",
          "",
          "  serve     start the API + web server",
          "  worker    start the scheduled crawl/enrich/rank/digest worker",
          "  migrate   apply pending database migrations",
          "  seed      seed companies from a CSV (default: scripts/companies.seed.csv)",
          "  crawl     run a crawl across active companies once",
          "  enrich    generate embeddings for jobs missing one",
          "  summarize generate a one-sentence summary for jobs missing one",
          "  rank      score every profile's shortlist and warm the ranking cache",
          "  digest    send the digest (ranked when available, deterministic otherwise)",
          "  discover    find ATS/careers-page candidates for company names (queues for review)",
          "  make-admin  grant a user admin access (required for /crawl-health, /discovery)",
        ].join("\n"),
      );
      await exitAfterFlush(command ? 1 : 0);
    }
  }
}

main().catch(async (error) => {
  console.error(error);
  await exitAfterFlush(1);
});
