import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import type { AuthEnv } from "@/auth/middleware";
import { attachSession } from "@/auth/middleware";
import { discoveryRoutes } from "@/api/discovery";
import { authRoutes } from "@/api/auth";
import { Hono } from "hono";
import { env } from "@/config";
import { db } from "@/db/client";
import { companies, companyDiscoveryCandidates, users } from "@/db/schema";
import { deleteTestUser, extractCookie, makeAdmin, uniqueEmail } from "../helpers/testApp";

// Standalone app (not the shared testApp() helper) so this file only pulls
// in what discoveryRoutes actually needs.
function testApp() {
  const app = new Hono<AuthEnv>();
  app.use("*", attachSession);
  app.route("/api/auth", authRoutes);
  app.route("/api/admin", discoveryRoutes);
  return app;
}

const originalFetch = globalThis.fetch;
const originalKey = env.ANTHROPIC_API_KEY;

describe("discovery admin routes", () => {
  const app = testApp();
  const email = uniqueEmail("discovery");
  const marker = crypto.randomUUID().slice(0, 8);
  let cookie: string;

  beforeAll(async () => {
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    cookie = extractCookie(res);
    await makeAdmin(email);
  });

  afterAll(async () => {
    await db.delete(companyDiscoveryCandidates).where(eq(companyDiscoveryCandidates.name, `Discovery Test Co ${marker}`));
    await db.delete(companies).where(eq(companies.slug, `discovery-test-co-${marker}`));
    await deleteTestUser(email);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    env.ANTHROPIC_API_KEY = originalKey;
  });

  it("rejects unauthenticated access to every route", async () => {
    expect((await app.request("/api/admin/discover", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/admin/discovery-candidates")).status).toBe(401);
    expect((await app.request("/api/admin/discovery-candidates/x/approve", { method: "POST" })).status).toBe(401);
  });

  it("rejects a non-admin user", async () => {
    const nonAdminEmail = uniqueEmail("discovery-non-admin");
    const signupRes = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: nonAdminEmail, password: "correct-horse-battery" }),
    });
    const nonAdminCookie = extractCookie(signupRes);

    const res = await app.request("/api/admin/discovery-candidates", { headers: { Cookie: nonAdminCookie } });
    expect(res.status).toBe(403);

    await deleteTestUser(nonAdminEmail);
  });

  it("discovers via heuristics, lists the pending candidate, then approves it into companies", async () => {
    const companyName = `Discovery Test Co ${marker}`;
    const expectedSlug = `discoverytestco${marker}`.toLowerCase();

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = url.toString();
      // Heuristic verification hits the real API endpoint, not the hosted
      // page — see src/discovery/heuristics.ts.
      if (href.includes(`boards-api.greenhouse.io/v1/boards/${expectedSlug}/jobs`)) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    const discoverRes = await app.request("/api/admin/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ companies: [{ name: companyName }] }),
    });
    expect(discoverRes.status).toBe(200);
    const discoverBody = await discoverRes.json();
    expect(discoverBody.results[0].matched).toBe(true);
    expect(discoverBody.results[0].source).toBe("heuristic");

    const listRes = await app.request("/api/admin/discovery-candidates", { headers: { Cookie: cookie } });
    const { candidates } = await listRes.json();
    const candidate = candidates.find((c: { name: string }) => c.name === companyName);
    expect(candidate).toBeTruthy();
    expect(candidate.guessedAts).toBe("greenhouse");
    expect(candidate.status).toBe("pending");

    const approveRes = await app.request(`/api/admin/discovery-candidates/${candidate.id}/approve`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(approveRes.status).toBe(200);

    const [createdCompany] = await db
      .select()
      .from(companies)
      .where(eq(companies.slug, `discovery-test-co-${marker}`));
    expect(createdCompany).toBeTruthy();
    expect(createdCompany?.atsIdentifier).toBe(expectedSlug);
    expect(createdCompany?.careersUrl).toContain("boards.greenhouse.io");

    const stillPending = await app.request("/api/admin/discovery-candidates", { headers: { Cookie: cookie } });
    const { candidates: afterApprove } = await stillPending.json();
    expect(afterApprove.some((c: { name: string }) => c.name === companyName)).toBe(false); // no longer pending
  });

  it("rejects approval of a candidate with no usable ATS guess", async () => {
    env.ANTHROPIC_API_KEY = undefined; // forces heuristics-miss + LLM-not-configured -> null guess
    globalThis.fetch = mock(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    const name = `No Guess Co ${marker}`;
    await app.request("/api/admin/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ companies: [{ name }] }),
    });

    const listRes = await app.request("/api/admin/discovery-candidates", { headers: { Cookie: cookie } });
    const { candidates } = await listRes.json();
    const candidate = candidates.find((c: { name: string }) => c.name === name);
    expect(candidate).toBeTruthy();
    expect(candidate.guessedAts).toBeNull();

    const approveRes = await app.request(`/api/admin/discovery-candidates/${candidate.id}/approve`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(approveRes.status).toBe(400);

    await db.delete(companyDiscoveryCandidates).where(eq(companyDiscoveryCandidates.name, name));
  });

  it("rejects a candidate and 404s on an unknown id", async () => {
    const name = `Reject Me Co ${marker}`;
    globalThis.fetch = mock(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    env.ANTHROPIC_API_KEY = undefined;

    await app.request("/api/admin/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ companies: [{ name }] }),
    });
    const { candidates } = await (await app.request("/api/admin/discovery-candidates", { headers: { Cookie: cookie } })).json();
    const candidate = candidates.find((c: { name: string }) => c.name === name);

    const rejectRes = await app.request(`/api/admin/discovery-candidates/${candidate.id}/reject`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(rejectRes.status).toBe(200);

    const notFoundRes = await app.request(`/api/admin/discovery-candidates/${crypto.randomUUID()}/reject`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(notFoundRes.status).toBe(404);

    await db.delete(companyDiscoveryCandidates).where(eq(companyDiscoveryCandidates.name, name));
  });

  it("lists tracked companies and can deactivate/reactivate one without deleting it", async () => {
    const [company] = await db
      .insert(companies)
      .values({
        name: `Tracked Co ${marker}`,
        slug: `tracked-co-${marker}`,
        ats: "greenhouse",
        atsIdentifier: `tracked-co-${marker}`,
        domain: "example.com",
      })
      .returning({ id: companies.id });

    const listRes = await app.request("/api/admin/companies", { headers: { Cookie: cookie } });
    expect(listRes.status).toBe(200);
    const { companies: listed } = await listRes.json();
    const found = listed.find((c: { id: string }) => c.id === company!.id);
    expect(found).toBeTruthy();
    expect(found.active).toBe(true);
    expect(found.domain).toBe("example.com");

    const deactivateRes = await app.request(`/api/admin/companies/${company!.id}/deactivate`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(deactivateRes.status).toBe(200);
    expect((await deactivateRes.json()).company.active).toBe(false);

    const reactivateRes = await app.request(`/api/admin/companies/${company!.id}/reactivate`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(reactivateRes.status).toBe(200);
    expect((await reactivateRes.json()).company.active).toBe(true);

    const notFoundRes = await app.request(`/api/admin/companies/${crypto.randomUUID()}/deactivate`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(notFoundRes.status).toBe(404);

    await db.delete(companies).where(eq(companies.id, company!.id));
  });
});
