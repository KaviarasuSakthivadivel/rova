import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { env } from "@/config";
import { db } from "@/db/client";
import { companies, EMBEDDING_DIMENSIONS, jobs } from "@/db/schema";
import { runEnrichment } from "@/pipeline/enrich";

const originalFetch = globalThis.fetch;
const originalKey = env.OPENAI_API_KEY;
const originalProvider = env.EMBEDDINGS_PROVIDER;

describe("runEnrichment", () => {
  const marker = crypto.randomUUID().slice(0, 8);
  let companyId: string;

  beforeAll(async () => {
    const [company] = await db
      .insert(companies)
      .values({ name: `Enrich Co ${marker}`, slug: `enrich-co-${marker}`, ats: "greenhouse", atsIdentifier: `enrich-co-${marker}` })
      .returning({ id: companies.id });
    companyId = company!.id;
  });

  afterAll(async () => {
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    env.OPENAI_API_KEY = originalKey;
    env.EMBEDDINGS_PROVIDER = originalProvider;
  });

  it("embeds jobs with a null embedding and leaves already-embedded jobs alone", async () => {
    // Pin the provider explicitly rather than relying on the ambient
    // default — this test's mock is shaped for OpenAI's response format,
    // and the dev .env may set EMBEDDINGS_PROVIDER=ollama (see src/embeddings/).
    env.EMBEDDINGS_PROVIDER = "openai";
    env.OPENAI_API_KEY = "test-key";

    // runEnrichment() is (correctly) global — it has no per-company scope.
    // Snapshot every OTHER job currently pending so we can restore them to
    // NULL afterward: without this, this test would permanently stamp a
    // meaningless dummy vector onto every real unrelated job in the dev DB
    // the first time it runs (discovered the hard way — see git history).
    const foreignPendingBefore = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, "OPEN"), isNull(jobs.embedding), ne(jobs.companyId, companyId)));

    const [pending] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "greenhouse",
        externalId: `pending-${marker}`,
        title: "Needs Embedding",
        jobUrl: "https://example.test/pending",
        status: "OPEN",
        contentHash: `pending-${marker}`,
        embedding: null,
      })
      .returning({ id: jobs.id });

    const [already] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "greenhouse",
        externalId: `already-${marker}`,
        title: "Already Embedded",
        jobUrl: "https://example.test/already",
        status: "OPEN",
        contentHash: `already-${marker}`,
        embedding: Array(EMBEDDING_DIMENSIONS).fill(0.5),
      })
      .returning({ id: jobs.id });

    let callCount = 0;
    globalThis.fetch = mock(async (_url, init) => {
      callCount += 1;
      const body = JSON.parse((init as RequestInit).body as string);
      const data = (body.input as string[]).map((_text: string, i: number) => ({
        embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1),
        index: i,
      }));
      return Response.json({ data });
    }) as unknown as typeof fetch;

    const result = await runEnrichment();

    // Don't assert exact global counts (result.embedded / callCount) —
    // other pending jobs may legitimately exist in the shared dev DB and
    // get correctly swept in too. Assert this test's own rows instead.
    expect(result.embedded).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBe(false);
    expect(callCount).toBeGreaterThanOrEqual(1);

    const [pendingRow] = await db.select({ embedding: jobs.embedding }).from(jobs).where(eq(jobs.id, pending!.id));
    expect(pendingRow?.embedding).toEqual(Array(EMBEDDING_DIMENSIONS).fill(0.1));

    const [alreadyRow] = await db.select({ embedding: jobs.embedding }).from(jobs).where(eq(jobs.id, already!.id));
    expect(alreadyRow?.embedding).toEqual(Array(EMBEDDING_DIMENSIONS).fill(0.5)); // untouched

    // Restore any foreign job this run swept in — see the comment above.
    if (foreignPendingBefore.length > 0) {
      await db
        .update(jobs)
        .set({ embedding: null })
        .where(
          inArray(
            jobs.id,
            foreignPendingBefore.map((j) => j.id),
          ),
        );
    }
  });

  it("skips (without throwing) when OPENAI_API_KEY isn't configured", async () => {
    env.EMBEDDINGS_PROVIDER = "openai"; // else the dev .env's Ollama default would mask this
    env.OPENAI_API_KEY = undefined;

    await db.insert(jobs).values({
      companyId,
      source: "greenhouse",
      externalId: `unconfigured-${marker}`,
      title: "Needs Embedding But No Key",
      jobUrl: "https://example.test/unconfigured",
      status: "OPEN",
      contentHash: `unconfigured-${marker}`,
      embedding: null,
    });

    const result = await runEnrichment();
    expect(result.skipped).toBe(true);
  });
});
