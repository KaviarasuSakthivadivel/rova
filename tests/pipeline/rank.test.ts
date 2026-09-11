import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { env } from "@/config";
import { db } from "@/db/client";
import { candidateProfiles, companies, jobs, users } from "@/db/schema";
import { rankShortlistForUser } from "@/pipeline/rank";

const originalFetch = globalThis.fetch;
const originalKey = env.ANTHROPIC_API_KEY;
const originalModel = env.ANTHROPIC_MODEL;
const EMBEDDING = Array(1536).fill(0.1);

function mockClaudeScoring(scoreFor: (jobTitle: string) => number) {
  let calls = 0;
  globalThis.fetch = mock(async (_url, init) => {
    calls += 1;
    const body = JSON.parse((init as RequestInit).body as string);
    const userMessage = body.messages[0].content as string;
    const titleMatch = /Title: (.+)/.exec(userMessage);
    const title = titleMatch?.[1] ?? "unknown";

    return Response.json({
      id: `msg_${calls}`,
      type: "message",
      role: "assistant",
      model: env.ANTHROPIC_MODEL,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            score: scoreFor(title),
            strongMatches: ["match"],
            missingRequirements: [],
            reasons: [`Reason for ${title}`],
          }),
        },
      ],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 20 },
    });
  }) as unknown as typeof fetch;
  return () => calls;
}

describe("rankShortlistForUser", () => {
  const marker = crypto.randomUUID().slice(0, 8);
  const email = `test-rank-${marker}@example.test`;
  let userId: string;
  let companyId: string;

  beforeAll(async () => {
    const [user] = await db.insert(users).values({ email, passwordHash: "x" }).returning({ id: users.id });
    userId = user!.id;

    const [company] = await db
      .insert(companies)
      .values({ name: `Rank Co ${marker}`, slug: `rank-co-${marker}`, ats: "greenhouse", atsIdentifier: `rank-co-${marker}` })
      .returning({ id: companies.id });
    companyId = company!.id;
  });

  afterAll(async () => {
    // job_rankings rows cascade-delete via their jobId/profileId FKs when
    // the jobs and the user (-> candidate_profiles) below are removed.
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await db.delete(users).where(eq(users.id, userId));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    env.ANTHROPIC_API_KEY = originalKey;
    env.ANTHROPIC_MODEL = originalModel;
  });

  it("returns a reason when there's no profile", async () => {
    const result = await rankShortlistForUser(userId);
    expect(result.reason).toBe("no profile");
    expect(result.ranked).toEqual([]);
  });

  it("returns a reason when the profile has no embedding", async () => {
    await db.insert(candidateProfiles).values({ userId, profileText: "Backend engineer.", embedding: null });
    const result = await rankShortlistForUser(userId);
    expect(result.reason).toBe("profile has no embedding yet");
    await db.delete(candidateProfiles).where(eq(candidateProfiles.userId, userId));
  });

  describe("with an embedded profile and jobs", () => {
    let jobAId: string;
    let jobBId: string;

    beforeAll(async () => {
      await db.insert(candidateProfiles).values({ userId, profileText: "Backend engineer. Java, Kafka.", embedding: EMBEDDING });

      const [jobA] = await db
        .insert(jobs)
        .values({
          companyId,
          source: "greenhouse",
          externalId: `rank-a-${marker}`,
          title: `Job Alpha ${marker}`,
          jobUrl: "https://example.test/a",
          status: "OPEN",
          contentHash: "hash-a-v1",
          embedding: EMBEDDING,
        })
        .returning({ id: jobs.id });
      jobAId = jobA!.id;

      const [jobB] = await db
        .insert(jobs)
        .values({
          companyId,
          source: "greenhouse",
          externalId: `rank-b-${marker}`,
          title: `Job Beta ${marker}`,
          jobUrl: "https://example.test/b",
          status: "OPEN",
          contentHash: "hash-b-v1",
          embedding: EMBEDDING,
        })
        .returning({ id: jobs.id });
      jobBId = jobB!.id;
    });

    it("returns a reason when ANTHROPIC_API_KEY isn't configured", async () => {
      env.ANTHROPIC_API_KEY = undefined;
      const result = await rankShortlistForUser(userId);
      expect(result.reason).toBe("ANTHROPIC_API_KEY is not configured");
    });

    it("scores the shortlist, ranks by score descending, and computes a cost estimate", async () => {
      env.ANTHROPIC_API_KEY = "test-key";
      env.ANTHROPIC_MODEL = "claude-sonnet-5";
      const getCalls = mockClaudeScoring((title) => (title.includes("Alpha") ? 60 : 95));

      const result = await rankShortlistForUser(userId);

      expect(result.reason).toBeUndefined();
      expect(result.scoredCount).toBe(2);
      expect(result.cachedCount).toBe(0);
      expect(getCalls()).toBe(2);
      expect(result.costUsd).not.toBeNull();

      expect(result.ranked.map((r) => r.jobId)).toEqual([jobBId, jobAId]); // Beta (95) before Alpha (60)
    });

    it("reuses cached scores on a second run without calling the API again", async () => {
      env.ANTHROPIC_API_KEY = "test-key";
      const getCalls = mockClaudeScoring(() => 100);

      const result = await rankShortlistForUser(userId);

      expect(result.scoredCount).toBe(0);
      expect(result.cachedCount).toBe(2);
      expect(getCalls()).toBe(0); // fetch never called — both jobs served from cache
      // Cached scores are the ones from the previous test, not the new mock's 100.
      expect(result.ranked.find((r) => r.jobId === jobBId)?.score.score).toBe(95);
    });

    it("re-scores a job once its content_hash changes (cache invalidation)", async () => {
      await db.update(jobs).set({ contentHash: "hash-a-v2" }).where(eq(jobs.id, jobAId));

      env.ANTHROPIC_API_KEY = "test-key";
      const getCalls = mockClaudeScoring((title) => (title.includes("Alpha") ? 10 : 95));

      const result = await rankShortlistForUser(userId);

      expect(getCalls()).toBe(1); // only the changed job (Alpha) was re-scored
      expect(result.scoredCount).toBe(1);
      expect(result.cachedCount).toBe(1);
      expect(result.ranked.find((r) => r.jobId === jobAId)?.score.score).toBe(10);
    });
  });
});
