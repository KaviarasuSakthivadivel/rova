import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { buildAuthorizeUrl, getValidAccessToken } from "@/applications/codexAuth";
import { db } from "@/db/client";
import { chatgptConnections, users } from "@/db/schema";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function fakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.`;
}

describe("buildAuthorizeUrl", () => {
  it("produces a PKCE challenge that's really the S256 hash of the verifier", async () => {
    const { url, codeVerifier, state } = buildAuthorizeUrl();
    const params = new URL(url).searchParams;

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
    const expectedChallenge = Buffer.from(digest).toString("base64url");

    expect(params.get("code_challenge")).toBe(expectedChallenge);
    expect(params.get("code_challenge_method")).toBe("S256");
    expect(params.get("state")).toBe(state);
    expect(params.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
  });

  it("generates a fresh verifier/state on every call", () => {
    const a = buildAuthorizeUrl();
    const b = buildAuthorizeUrl();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.state).not.toBe(b.state);
  });
});

describe("getValidAccessToken", () => {
  const marker = crypto.randomUUID().slice(0, 8);
  let userId: string;

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `codex-auth-${marker}@example.test`, passwordHash: "test" })
      .returning({ id: users.id });
    userId = user!.id;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
  });

  afterEach(async () => {
    await db.delete(chatgptConnections).where(eq(chatgptConnections.userId, userId));
  });

  it("returns null when the user has no ChatGPT connection", async () => {
    expect(await getValidAccessToken(userId)).toBeNull();
  });

  it("returns the stored token directly when it isn't near expiry, without refreshing", async () => {
    globalThis.fetch = (() => {
      throw new Error("should not have attempted a refresh for a non-stale token");
    }) as unknown as typeof fetch;

    const freshAccessToken = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    await db.insert(chatgptConnections).values({
      userId,
      accessToken: freshAccessToken,
      refreshToken: "refresh-token",
      idToken: fakeJwt({ email: "person@example.test" }),
      accountId: "acct_test",
    });

    expect(await getValidAccessToken(userId)).toEqual({ accessToken: freshAccessToken, accountId: "acct_test" });
  });

  it("clears the connection and returns null when a refresh is attempted and rejected", async () => {
    globalThis.fetch = (async () => new Response("invalid_grant", { status: 400 })) as unknown as typeof fetch;

    const expiredAccessToken = fakeJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
    await db.insert(chatgptConnections).values({
      userId,
      accessToken: expiredAccessToken,
      refreshToken: "refresh-token",
      idToken: fakeJwt({}),
      accountId: "acct_test",
    });

    expect(await getValidAccessToken(userId)).toBeNull();

    const [row] = await db.select().from(chatgptConnections).where(eq(chatgptConnections.userId, userId)).limit(1);
    expect(row).toBeUndefined();
  });
});
