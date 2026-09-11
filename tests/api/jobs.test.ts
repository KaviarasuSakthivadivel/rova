import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, jobs } from "@/db/schema";
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
});
