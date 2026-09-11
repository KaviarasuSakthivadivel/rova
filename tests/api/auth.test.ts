import { afterAll, describe, expect, it } from "bun:test";
import { deleteTestUser, extractCookie, testApp, uniqueEmail } from "../helpers/testApp";

describe("auth routes", () => {
  const app = testApp();
  const email = uniqueEmail("auth");
  const password = "correct-horse-battery";

  afterAll(() => deleteTestUser(email));

  it("rejects /me without a session", async () => {
    const res = await app.request("/api/auth/me");
    expect(res.status).toBe(200);
    expect((await res.json()).user).toBeNull();
  });

  it("signs up, sets a session cookie, and returns the user", async () => {
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe(email);
    expect(res.headers.get("set-cookie")).toContain("rova_session=");
  });

  it("rejects a duplicate signup", async () => {
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(409);
  });

  it("rejects login with the wrong password", async () => {
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
  });

  it("logs in with the right password and can then read /me", async () => {
    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = extractCookie(loginRes);

    const meRes = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    const body = await meRes.json();
    expect(body.user.email).toBe(email);
  });

  it("logs out and invalidates the session", async () => {
    const loginRes = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const cookie = extractCookie(loginRes);

    const logoutRes = await app.request("/api/auth/logout", { method: "POST", headers: { Cookie: cookie } });
    expect(logoutRes.status).toBe(200);

    const meRes = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    expect((await meRes.json()).user).toBeNull();
  });

  it("rejects a signup password under 8 characters", async () => {
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: uniqueEmail("short-pw"), password: "short" }),
    });
    expect(res.status).toBe(400);
  });
});
