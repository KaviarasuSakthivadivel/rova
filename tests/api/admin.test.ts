import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, crawlRuns } from "@/db/schema";
import { deleteTestUser, extractCookie, testApp, uniqueEmail } from "../helpers/testApp";

describe("admin routes", () => {
  const app = testApp();
  const email = uniqueEmail("admin");
  const marker = crypto.randomUUID().slice(0, 8);
  let cookie: string;
  let companyId: string;

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
        name: `Admin Test Co ${marker}`,
        slug: `admin-test-co-${marker}`,
        ats: "greenhouse",
        atsIdentifier: `admin-test-co-${marker}`,
      })
      .returning({ id: companies.id });
    companyId = company!.id;

    await db.insert(crawlRuns).values([
      {
        companyId,
        status: "success",
        startedAt: new Date(Date.now() - 60_000),
        finishedAt: new Date(Date.now() - 55_000),
        jobsSeen: 10,
        jobsAdded: 2,
        jobsUpdated: 1,
        jobsClosed: 0,
      },
      {
        companyId,
        status: "failed",
        startedAt: new Date(),
        finishedAt: new Date(),
        errorMessage: `boom ${marker}`,
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(crawlRuns).where(eq(crawlRuns.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    await deleteTestUser(email);
  });

  it("rejects unauthenticated access", async () => {
    const res = await app.request("/api/admin/crawl-runs");
    expect(res.status).toBe(401);
  });

  it("lists recent crawl runs, most recent first, with the company name joined", async () => {
    const res = await app.request("/api/admin/crawl-runs", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);

    const body = await res.json();
    const ours = body.runs.filter((r: { companyName: string }) => r.companyName === `Admin Test Co ${marker}`);
    expect(ours).toHaveLength(2);
    expect(ours[0].status).toBe("failed"); // most recent (just now) sorts first
    expect(ours[0].errorMessage).toBe(`boom ${marker}`);
    expect(ours[1].status).toBe("success");
    expect(ours[1].jobsAdded).toBe(2);
  });

  it("respects the limit query param", async () => {
    const res = await app.request("/api/admin/crawl-runs?limit=1", { headers: { Cookie: cookie } });
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
  });
});
