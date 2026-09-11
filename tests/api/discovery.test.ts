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
import { deleteTestUser, extractCookie, uniqueEmail } from "../helpers/testApp";

// discoveryRoutes isn't mounted in src/server.ts yet (left to the
// coordinator to integrate) — build a minimal app here with the same
// middleware wiring createApp() uses, so this tests the real route module
// without depending on that integration.
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

  it("discovers via heuristics, lists the pending candidate, then approves it into companies", async () => {
    const companyName = `Discovery Test Co ${marker}`;
    const expectedSlug = `discoverytestco${marker}`.toLowerCase();

    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = url.toString();
      if (href.includes(`boards.greenhouse.io/${expectedSlug}`)) return new Response(null, { status: 200 });
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
});
