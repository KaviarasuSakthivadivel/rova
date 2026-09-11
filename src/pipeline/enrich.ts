import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { jobs } from "@/db/schema";
import { embedTexts, EmbeddingsNotConfiguredError } from "@/embeddings";

const BATCH_SIZE = 100;

function embeddingInput(job: { title: string; description: string | null; location: string | null }): string {
  return [job.title, job.location ?? "", job.description ?? ""].filter(Boolean).join("\n\n");
}

export interface EnrichResult {
  embedded: number;
  pending: number;
  skipped: boolean;
  reason?: string;
}

/**
 * Its own batch job over new/changed rows (embedding IS NULL — see
 * ingest.ts, which nulls it out on any content change), decoupled from
 * the crawler per PRD.md §5: a failed/unconfigured embeddings provider
 * must never block tomorrow's crawl.
 */
export async function runEnrichment(): Promise<EnrichResult> {
  const pending = await db
    .select({ id: jobs.id, title: jobs.title, description: jobs.description, location: jobs.location })
    .from(jobs)
    .where(and(eq(jobs.status, "OPEN"), isNull(jobs.embedding)));

  if (pending.length === 0) {
    console.log("[enrich] nothing to embed");
    return { embedded: 0, pending: 0, skipped: false };
  }

  console.log(`[enrich] embedding ${pending.length} jobs`);

  let embedded = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    let vectors: number[][];
    try {
      vectors = await embedTexts(batch.map(embeddingInput));
    } catch (error) {
      if (error instanceof EmbeddingsNotConfiguredError) {
        console.warn(`[enrich] embeddings not available (${error.message}) — skipping`);
        return { embedded, pending: pending.length - embedded, skipped: true, reason: error.message };
      }
      throw error;
    }

    for (let j = 0; j < batch.length; j++) {
      const job = batch[j];
      const vector = vectors[j];
      if (!job || !vector) continue;
      await db.update(jobs).set({ embedding: vector, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      embedded += 1;
    }
    console.log(`[enrich] embedded ${embedded}/${pending.length}`);
  }

  return { embedded, pending: 0, skipped: false };
}
