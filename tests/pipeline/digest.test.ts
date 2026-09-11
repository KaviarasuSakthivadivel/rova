import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { candidateProfiles, companies, digestDeliveries, jobs, userJobActions, users } from "@/db/schema";
import { runDigestForUser, selectDigestJobsForUser } from "@/pipeline/digest";

describe("digest pipeline", () => {
  const marker = crypto.randomUUID().slice(0, 8);
  const email = `test-digest-${marker}@example.test`;

  let userId: string;
  let companyId: string;
  let freshJobId: string;
  let staleJobId: string;
  let berlinJobId: string;

  beforeAll(async () => {
    const [user] = await db.insert(users).values({ email, passwordHash: "not-a-real-hash" }).returning({ id: users.id });
    userId = user!.id;

    const [company] = await db
      .insert(companies)
      .values({ name: `Digest Co ${marker}`, slug: `digest-co-${marker}`, ats: "greenhouse", atsIdentifier: `digest-co-${marker}` })
      .returning({ id: companies.id });
    companyId = company!.id;

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    const [fresh] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "greenhouse",
        externalId: `fresh-${marker}`,
        title: `Fresh Job ${marker}`,
        location: "Remote",
        jobUrl: "https://example.test/fresh",
        status: "OPEN",
        contentHash: `fresh-${marker}`,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: jobs.id });
    freshJobId = fresh!.id;

    const [stale] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "greenhouse",
        externalId: `stale-${marker}`,
        title: `Stale Job ${marker}`,
        location: "Remote",
        jobUrl: "https://example.test/stale",
        status: "OPEN",
        contentHash: `stale-${marker}`,
        firstSeenAt: twoDaysAgo,
        lastSeenAt: twoDaysAgo,
      })
      .returning({ id: jobs.id });
    staleJobId = stale!.id;

    const [berlin] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "greenhouse",
        externalId: `berlin-${marker}`,
        title: `Berlin Job ${marker}`,
        location: "Berlin, Germany",
        jobUrl: "https://example.test/berlin",
        status: "OPEN",
        contentHash: `berlin-${marker}`,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: jobs.id });
    berlinJobId = berlin!.id;
  });

  afterAll(async () => {
    await db.delete(digestDeliveries).where(eq(digestDeliveries.userId, userId));
    await db.delete(userJobActions).where(eq(userJobActions.userId, userId));
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("returns nothing for a user without a profile", async () => {
    const result = await selectDigestJobsForUser(userId);
    expect(result).toEqual([]);
  });

  it("matches recent open jobs once a profile exists, excluding jobs outside the 24h window", async () => {
    await db.insert(candidateProfiles).values({ userId, profileText: "Anything goes.", preferences: {} });

    const result = await selectDigestJobsForUser(userId);
    const ids = result.map((r) => r.jobId);

    expect(ids).toContain(freshJobId);
    expect(ids).toContain(berlinJobId);
    expect(ids).not.toContain(staleJobId);
  });

  it("filters by preferred location when set", async () => {
    await db
      .update(candidateProfiles)
      .set({ preferences: { locations: ["Berlin"] } })
      .where(eq(candidateProfiles.userId, userId));

    const result = await selectDigestJobsForUser(userId);
    const ids = result.map((r) => r.jobId);

    expect(ids).toContain(berlinJobId);
    expect(ids).not.toContain(freshJobId); // "Remote" doesn't match the "Berlin" preference
  });

  it("excludes dismissed jobs", async () => {
    await db
      .update(candidateProfiles)
      .set({ preferences: {} })
      .where(eq(candidateProfiles.userId, userId));
    await db.insert(userJobActions).values({ userId, jobId: freshJobId, action: "dismissed" });

    const result = await selectDigestJobsForUser(userId);
    expect(result.map((r) => r.jobId)).not.toContain(freshJobId);
  });

  it("excludes jobs already sent in a previous digest (dedup)", async () => {
    await db.insert(digestDeliveries).values({
      userId,
      profileId: (await db.select({ id: candidateProfiles.id }).from(candidateProfiles).where(eq(candidateProfiles.userId, userId)))[0]!.id,
      channel: "email",
      jobIds: [berlinJobId],
    });

    const result = await selectDigestJobsForUser(userId);
    expect(result.map((r) => r.jobId)).not.toContain(berlinJobId);
  });

  it("runDigestForUser doesn't record a delivery when email isn't actually sent (no RESEND_API_KEY in this env)", async () => {
    // freshJobId is dismissed and berlinJobId was already "delivered" by the
    // previous test, so re-seed a clean candidate for this one.
    const [job] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "greenhouse",
        externalId: `run-${marker}`,
        title: `Run Job ${marker}`,
        location: "Remote",
        jobUrl: "https://example.test/run",
        status: "OPEN",
        contentHash: `run-${marker}`,
      })
      .returning({ id: jobs.id });

    const before = await db.select().from(digestDeliveries).where(eq(digestDeliveries.userId, userId));

    const result = await runDigestForUser(userId, email);

    expect(result.sent).toBe(false);
    expect(result.reason).toContain("RESEND_API_KEY");
    expect(result.jobCount).toBeGreaterThan(0);

    const after = await db.select().from(digestDeliveries).where(eq(digestDeliveries.userId, userId));
    expect(after.length).toBe(before.length); // no new delivery row written

    await db.delete(jobs).where(eq(jobs.id, job!.id));
  });
});
