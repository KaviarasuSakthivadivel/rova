import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { candidateProfiles, companies, jobs } from "@/db/schema";
import { deleteTestUser, extractCookie, testApp, uniqueEmail } from "../helpers/testApp";

describe("jobs routes", () => {
  const app = testApp();
  const email = uniqueEmail("jobs");
  let cookie: string;
  let companyId: string;
  let jobId: string;

  const marker = crypto.randomUUID().slice(0, 8);
  const jobTitle = `Zzyzx Test Engineer ${marker}`;

  beforeAll(async () => {
    const signupRes = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    cookie = extractCookie(signupRes);

    const [company] = await db
      .insert(companies)
      .values({
        name: `Test Co ${marker}`,
        slug: `test-co-${marker}`,
        ats: "greenhouse",
        atsIdentifier: `test-co-${marker}`,
      })
      .returning({ id: companies.id });
    companyId = company!.id;

    const [job] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "greenhouse",
        externalId: `ext-${marker}`,
        title: jobTitle,
        description: "A job that only this test's search query will match.",
        location: "Nowhere, NA",
        jobUrl: "https://example.test/job",
        status: "OPEN",
        contentHash: `hash-${marker}`,
      })
      .returning({ id: jobs.id });
    jobId = job!.id;
  });

  afterAll(async () => {
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await deleteTestUser(email);
  });

  it("rejects unauthenticated access", async () => {
    const res = await app.request("/api/jobs");
    expect(res.status).toBe(401);
  });

  it("finds the seeded job by title keyword", async () => {
    const res = await app.request(`/api/jobs?q=${encodeURIComponent(marker)}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].job.title).toBe(jobTitle);
    expect(body.jobs[0].companyName).toBe(`Test Co ${marker}`);
    expect(body.jobs[0].action).toBeNull();
  });

  it("filters by location", async () => {
    const matching = await app.request(`/api/jobs?location=Nowhere`, { headers: { Cookie: cookie } });
    expect((await matching.json()).jobs.some((j: { job: { id: string } }) => j.job.id === jobId)).toBe(true);

    const nonMatching = await app.request(`/api/jobs?location=Antarctica`, { headers: { Cookie: cookie } });
    expect((await nonMatching.json()).jobs.some((j: { job: { id: string } }) => j.job.id === jobId)).toBe(false);
  });

  it("filters by companyIds", async () => {
    const [otherCompany] = await db
      .insert(companies)
      .values({ name: `Other Co ${marker}`, slug: `other-co-${marker}`, ats: "greenhouse", atsIdentifier: `other-co-${marker}` })
      .returning({ id: companies.id });
    const [otherJob] = await db
      .insert(jobs)
      .values({
        companyId: otherCompany!.id,
        source: "greenhouse",
        externalId: `ext-other-${marker}`,
        title: `Zzyzx Other Engineer ${marker}`,
        jobUrl: "https://example.test/other-job",
        status: "OPEN",
        contentHash: `hash-other-${marker}`,
      })
      .returning({ id: jobs.id });

    try {
      const onlyOriginal = await app.request(`/api/jobs?q=${encodeURIComponent(marker)}&companyIds=${companyId}`, { headers: { Cookie: cookie } });
      const originalBody = await onlyOriginal.json();
      expect(originalBody.jobs.some((j: { job: { id: string } }) => j.job.id === jobId)).toBe(true);
      expect(originalBody.jobs.some((j: { job: { id: string } }) => j.job.id === otherJob!.id)).toBe(false);

      const both = await app.request(`/api/jobs?q=${encodeURIComponent(marker)}&companyIds=${companyId},${otherCompany!.id}`, {
        headers: { Cookie: cookie },
      });
      const bothBody = await both.json();
      expect(bothBody.jobs.some((j: { job: { id: string } }) => j.job.id === jobId)).toBe(true);
      expect(bothBody.jobs.some((j: { job: { id: string } }) => j.job.id === otherJob!.id)).toBe(true);
    } finally {
      await db.delete(jobs).where(eq(jobs.id, otherJob!.id));
      await db.delete(companies).where(eq(companies.id, otherCompany!.id));
    }
  });

  it("filters by seniority using the title heuristic", async () => {
    // The seeded job's title ("Zzyzx Test Engineer") has no seniority
    // keyword, so it falls into the "mid" bucket by default. A "senior"
    // filter should exclude it; a "mid" filter should include it.
    const seniorOnly = await app.request(`/api/jobs?q=${encodeURIComponent(marker)}&seniority=senior`, { headers: { Cookie: cookie } });
    expect((await seniorOnly.json()).jobs.some((j: { job: { id: string } }) => j.job.id === jobId)).toBe(false);

    const midOnly = await app.request(`/api/jobs?q=${encodeURIComponent(marker)}&seniority=mid`, { headers: { Cookie: cookie } });
    expect((await midOnly.json()).jobs.some((j: { job: { id: string } }) => j.job.id === jobId)).toBe(true);

    const midOrSenior = await app.request(`/api/jobs?q=${encodeURIComponent(marker)}&seniority=mid,senior`, { headers: { Cookie: cookie } });
    expect((await midOrSenior.json()).jobs.some((j: { job: { id: string } }) => j.job.id === jobId)).toBe(true);
  });

  it("lists companies with at least one open job, for the filter facet", async () => {
    const res = await app.request("/api/jobs/companies", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.companies.some((c: { id: string; count: number }) => c.id === companyId && c.count >= 1)).toBe(true);
  });

  it("suggests real location strings from the data for the location typeahead", async () => {
    const res = await app.request(`/api/jobs/locations?search=${encodeURIComponent("Nowhere")}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.locations.some((l: { location: string; count: number }) => l.location === "Nowhere, NA" && l.count >= 1)).toBe(true);
  });

  it("does not suggest locations that don't match the search text", async () => {
    const res = await app.request(`/api/jobs/locations?search=${encodeURIComponent("Antarctica")}`, { headers: { Cookie: cookie } });
    const body = await res.json();
    expect(body.locations.some((l: { location: string }) => l.location === "Nowhere, NA")).toBe(false);
  });

  it("scopes location suggestions by the currently active company filter", async () => {
    const [otherCompany] = await db
      .insert(companies)
      .values({ name: `Loc Co ${marker}`, slug: `loc-co-${marker}`, ats: "greenhouse", atsIdentifier: `loc-co-${marker}` })
      .returning({ id: companies.id });
    const [otherJob] = await db
      .insert(jobs)
      .values({
        companyId: otherCompany!.id,
        source: "greenhouse",
        externalId: `ext-loc-${marker}`,
        title: `Zzyzx Loc Engineer ${marker}`,
        location: "Nowhere Else, NA",
        jobUrl: "https://example.test/loc-job",
        status: "OPEN",
        contentHash: `hash-loc-${marker}`,
      })
      .returning({ id: jobs.id });

    try {
      const scoped = await app.request(`/api/jobs/locations?search=Nowhere&companyIds=${companyId}`, { headers: { Cookie: cookie } });
      const scopedBody = await scoped.json();
      expect(scopedBody.locations.some((l: { location: string }) => l.location === "Nowhere, NA")).toBe(true);
      expect(scopedBody.locations.some((l: { location: string }) => l.location === "Nowhere Else, NA")).toBe(false);
    } finally {
      await db.delete(jobs).where(eq(jobs.id, otherJob!.id));
      await db.delete(companies).where(eq(companies.id, otherCompany!.id));
    }
  });

  it("scopes facet counts to the current search, not a static per-company total", async () => {
    // Regression test: the filter sidebar's counts used to come from
    // GET /api/jobs/companies, a static "total open jobs at this
    // company" that never changed with the search — so e.g. switching
    // to semantic mode with 0 real matches still showed a stale full
    // count. GET /api/jobs/facets must reflect the live search instead.
    const marker2 = crypto.randomUUID().slice(0, 8);
    const unmatched = await app.request(`/api/jobs/facets?q=${encodeURIComponent(marker2)}`, { headers: { Cookie: cookie } });
    expect(unmatched.status).toBe(200);
    const unmatchedBody = await unmatched.json();
    expect(unmatchedBody.companies.find((c: { id: string; count: number }) => c.id === companyId)?.count ?? 0).toBe(0);

    const matched = await app.request(`/api/jobs/facets?q=${encodeURIComponent(marker)}`, { headers: { Cookie: cookie } });
    const matchedBody = await matched.json();
    expect(matchedBody.companies.find((c: { id: string; count: number }) => c.id === companyId)?.count).toBeGreaterThanOrEqual(1);

    // The seeded job's title has no seniority keyword, so it's "mid".
    expect(matchedBody.seniority.mid).toBeGreaterThanOrEqual(1);
  });

  it("returns empty facets for semantic mode with no profile yet, rather than erroring", async () => {
    const { extractCookie, testApp, uniqueEmail } = await import("../helpers/testApp");
    const freshApp = testApp();
    const freshEmail = uniqueEmail("jobs-facets-no-profile");
    const signupRes = await freshApp.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: freshEmail, password: "correct-horse-battery" }),
    });
    const freshCookie = extractCookie(signupRes);

    const res = await freshApp.request("/api/jobs/facets?semantic=true", { headers: { Cookie: freshCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.companies).toEqual([]);
    expect(body.seniority).toEqual({ intern: 0, entry: 0, mid: 0, senior: 0, staff: 0, lead: 0 });

    await deleteTestUser(freshEmail);
  });

  it("filters by postedWithinDays using firstSeenAt", async () => {
    // The seeded job was just inserted, so a 7-day cutoff includes it.
    const withinRange = await app.request(`/api/jobs?q=${encodeURIComponent(marker)}&postedWithinDays=7`, { headers: { Cookie: cookie } });
    expect((await withinRange.json()).jobs.some((j: { job: { id: string } }) => j.job.id === jobId)).toBe(true);

    try {
      await db.update(jobs).set({ firstSeenAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }).where(eq(jobs.id, jobId));
      const outsideRange = await app.request(`/api/jobs?q=${encodeURIComponent(marker)}&postedWithinDays=7`, { headers: { Cookie: cookie } });
      expect((await outsideRange.json()).jobs.some((j: { job: { id: string } }) => j.job.id === jobId)).toBe(false);
    } finally {
      await db.update(jobs).set({ firstSeenAt: new Date() }).where(eq(jobs.id, jobId));
    }
  });

  it("signals hasMore for infinite scroll without an extra COUNT query", async () => {
    const page1 = await app.request(`/api/jobs?q=${encodeURIComponent(marker)}&limit=1&offset=0`, { headers: { Cookie: cookie } });
    const body1 = await page1.json();
    expect(body1.jobs).toHaveLength(1);
    expect(body1.hasMore).toBe(false); // only one seeded job matches this marker

    const page2 = await app.request(`/api/jobs?q=${encodeURIComponent(marker)}&limit=1&offset=1`, { headers: { Cookie: cookie } });
    const body2 = await page2.json();
    expect(body2.jobs).toHaveLength(0);
    expect(body2.hasMore).toBe(false);
  });

  it("returns 404 for a job action on an unknown id", async () => {
    const res = await app.request(`/api/jobs/${crypto.randomUUID()}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ action: "saved" }),
    });
    expect(res.status).toBe(404);
  });

  it("saves a job, then changes it to dismissed (upsert, not a duplicate row)", async () => {
    const saveRes = await app.request(`/api/jobs/${jobId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ action: "saved" }),
    });
    expect(saveRes.status).toBe(200);

    let getRes = await app.request(`/api/jobs/${jobId}`, { headers: { Cookie: cookie } });
    expect((await getRes.json()).action).toBe("saved");

    const dismissRes = await app.request(`/api/jobs/${jobId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ action: "dismissed" }),
    });
    expect(dismissRes.status).toBe(200);

    getRes = await app.request(`/api/jobs/${jobId}`, { headers: { Cookie: cookie } });
    expect((await getRes.json()).action).toBe("dismissed");
  });

  describe("new-count / mark-seen", () => {
    it("returns 0 with no profile yet", async () => {
      const res = await app.request("/api/jobs/new-count", { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ count: 0, since: null });
    });

    it("counts open jobs seen after the profile's cutoff, then resets after marking seen", async () => {
      // Backdate createdAt so the "new since" cutoff falls before the
      // seeded job's firstSeenAt (the job was inserted in beforeAll,
      // earlier than this profile row) — otherwise nothing would count
      // as new relative to a profile created just now.
      await db.insert(candidateProfiles).values({ userId: await getUserId(), profileText: "test profile", createdAt: new Date(0) });

      const before = await app.request("/api/jobs/new-count", { headers: { Cookie: cookie } });
      expect((await before.json()).count).toBeGreaterThanOrEqual(1);

      const markRes = await app.request("/api/jobs/mark-seen", { method: "POST", headers: { Cookie: cookie } });
      expect(markRes.status).toBe(200);

      const after = await app.request("/api/jobs/new-count", { headers: { Cookie: cookie } });
      expect((await after.json()).count).toBe(0);
    });

    async function getUserId(): Promise<string> {
      const meRes = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
      const { user } = await meRes.json();
      return user.id;
    }
  });
});
