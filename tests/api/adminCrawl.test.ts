import { afterAll, describe, expect, it, mock } from "bun:test";

// runCrawl hits real ATS APIs — mock it so this test exercises the route's
// own logic (auth, the concurrency guard, response shape) without a real
// crawl running. mock.module works retroactively in Bun even though
// src/api/admin.ts statically imports the real runCrawl, as long as the
// modules that transitively import it are pulled in via a dynamic
// `await import()` *after* this call, not a top-level static import.
let crawlCalls = 0;
mock.module("@/pipeline/crawl", () => ({
  runCrawl: mock(() => {
    crawlCalls += 1;
    return new Promise<void>(() => {}); // never resolves — keeps "in progress" stable for the guard test
  }),
}));

describe("POST /admin/crawl", () => {
  it("requires auth, then starts a crawl and rejects a concurrent trigger", async () => {
    const { deleteTestUser, extractCookie, makeAdmin, testApp, uniqueEmail } = await import("../helpers/testApp");
    const app = testApp();
    const email = uniqueEmail("admin-crawl");

    const unauth = await app.request("/api/admin/crawl", { method: "POST" });
    expect(unauth.status).toBe(401);

    const signupRes = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    const cookie = extractCookie(signupRes);
    await makeAdmin(email);

    const first = await app.request("/api/admin/crawl", { method: "POST", headers: { Cookie: cookie } });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, started: true });

    const second = await app.request("/api/admin/crawl", { method: "POST", headers: { Cookie: cookie } });
    expect(second.status).toBe(409);

    expect(crawlCalls).toBe(1); // the second request never called runCrawl again

    await deleteTestUser(email);
  });
});
