import { Cron } from "croner";
import { runCrawl } from "@/pipeline/crawl";
import { runDigest } from "@/pipeline/digest";
import { runEnrichment } from "@/pipeline/enrich";
import { runSummarization } from "@/pipeline/summarize";

/**
 * Long-running process: croner schedules each pipeline stage
 * independently, so a broken enrichment/ranking run never blocks
 * tomorrow's crawl (PRD.md §5). Each stage runs after the one it depends
 * on has had time to finish, not inline — a slow/failing embeddings or
 * digest call never delays ingestion. Ranking (Claude scoring) runs
 * inline inside the digest job rather than as its own cron entry — it
 * exists only to feed the digest, so there's no other consumer to
 * schedule it independently for (see src/pipeline/rank.ts / digest.ts).
 */
export function startWorker() {
  console.log("rova worker starting — scheduling pipeline stages");

  new Cron("0 2 * * *", { name: "crawl" }, async () => {
    console.log("[worker] running scheduled crawl");
    await runCrawl();
  });

  new Cron("0 3 * * *", { name: "enrich" }, async () => {
    console.log("[worker] running scheduled enrichment");
    await runEnrichment();
  });

  new Cron("30 3 * * *", { name: "summarize" }, async () => {
    console.log("[worker] running scheduled summarization");
    await runSummarization();
  });

  new Cron("0 7 * * *", { name: "digest" }, async () => {
    console.log("[worker] running scheduled digest");
    await runDigest();
  });

  console.log("rova worker running (crawl: 02:00, enrich: 03:00, summarize: 03:30, digest: 07:00 daily)");
}
