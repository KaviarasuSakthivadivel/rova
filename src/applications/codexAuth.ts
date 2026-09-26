import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { chatgptConnections } from "@/db/schema";

/**
 * OAuth2 + PKCE sign-in against the user's own ChatGPT Plus/Pro subscription,
 * so packet generation (src/applications/codex.ts) can run on that plan
 * instead of a metered API key. Ported from metaharn's own working
 * implementation (packages/engine/src/providers/codexAuth.ts) — same
 * endpoints, same public subscription client id (baked into every copy of
 * OpenAI's own Codex CLI, not a secret), same fixed loopback port. Tokens
 * land in Postgres (chatgptConnections, one row per Rova user) instead of
 * metaharn's per-operator plaintext file — same honest security bar
 * (plaintext, protected only by access control, not encryption-at-rest).
 */

const AUTH_ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${AUTH_ISSUER}/oauth/authorize`;
const TOKEN_URL = `${AUTH_ISSUER}/oauth/token`;
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
// Registered redirect for CLIENT_ID, verbatim — host and port aren't ours to choose.
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const SCOPE = "openid profile email offline_access";
const ORIGINATOR = "rova";
export const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const FLOW_TIMEOUT_MS = 300_000;
// Refresh this close to the JWT `exp` instead of sending an about-to-die bearer.
const REFRESH_MARGIN_SECONDS = 300;
const ACCOUNT_CLAIM = "https://api.openai.com/auth";

export const PLAN_LIMIT_ERROR =
  "ChatGPT plan limit reached — your subscription's rolling usage window is used up. Wait for it to reset, or switch PACKET_GENERATION_PROVIDER back to claude/ollama.";

export class CodexAuthError extends Error {}

// -- PKCE / JWT helpers -----------------------------------------------------

function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const digest = createHash("sha256").update(verifier, "ascii").digest();
  return { verifier, challenge: digest.toString("base64url") };
}

/** Decode a JWT payload WITHOUT verification — only routing claims (`exp`,
 * the account object) are read; the backend is the one verifying signatures. */
function jwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1] ?? "";
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function accountInfoFrom(idToken: string, accessToken: string): { accountId: string; email: string | null } {
  let accountId = "";
  for (const token of [idToken, accessToken]) {
    const auth = jwtClaims(token)[ACCOUNT_CLAIM];
    if (auth && typeof auth === "object") {
      const acct = (auth as Record<string, unknown>).chatgpt_account_id ?? (auth as Record<string, unknown>).account_id;
      if (typeof acct === "string" && acct) {
        accountId = acct;
        break;
      }
    }
  }
  const email = jwtClaims(idToken).email;
  return { accountId, email: typeof email === "string" && email ? email : null };
}

/** The non-auth headers every backend request must carry (auth is the bearer). */
export function backendHeaders(accountId: string, sessionId: string): Record<string, string> {
  return {
    "chatgpt-account-id": accountId,
    originator: ORIGINATOR,
    "OpenAI-Beta": "responses=experimental",
    "session-id": sessionId,
  };
}

// -- authorize URL ------------------------------------------------------------

export interface AuthorizeUrlResult {
  url: string;
  codeVerifier: string;
  state: string;
}

export function buildAuthorizeUrl(): AuthorizeUrlResult {
  const { verifier, challenge } = createPkce();
  const state = randomBytes(18).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    codex_cli_simplified_flow: "true",
    originator: ORIGINATOR,
  });
  return { url: `${AUTHORIZE_URL}?${params.toString()}`, codeVerifier: verifier, state };
}

// -- token exchange / refresh -------------------------------------------------

interface TokenResponseJson {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
}

async function tokenPost(data: Record<string, string>): Promise<TokenResponseJson> {
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(data).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new CodexAuthError(`ChatGPT token request failed (HTTP ${resp.status})`);
  return (await resp.json()) as TokenResponseJson;
}

async function upsertTokens(userId: string, tokens: TokenResponseJson, existing?: { accessToken: string; refreshToken: string; idToken: string }): Promise<void> {
  const accessToken = tokens.access_token ?? existing?.accessToken;
  const refreshToken = tokens.refresh_token ?? existing?.refreshToken;
  const idToken = tokens.id_token ?? existing?.idToken;
  if (!accessToken || !refreshToken || !idToken) {
    throw new CodexAuthError("ChatGPT token response was missing a required token");
  }

  const { accountId, email } = accountInfoFrom(idToken, accessToken);

  await db
    .insert(chatgptConnections)
    .values({ userId, accessToken, refreshToken, idToken, accountId, accountEmail: email })
    .onConflictDoUpdate({
      target: chatgptConnections.userId,
      set: { accessToken, refreshToken, idToken, accountId, accountEmail: email, updatedAt: new Date() },
    });
}

/**
 * Starts a temporary loopback HTTP server on CALLBACK_PORT, waits for
 * OpenAI's OAuth redirect, exchanges the code for tokens, and persists them.
 * Rejects (and always tears the listener down) on timeout, a port already in
 * use, a state mismatch, or an error from the auth service.
 */
export function runLoopbackFlow({ codeVerifier, state, userId }: { codeVerifier: string; state: string; userId: string }): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.stop(true);
      fn();
    };

    const server = Bun.serve({
      port: CALLBACK_PORT,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== CALLBACK_PATH) {
          return new Response("not found", { status: 404 });
        }

        const error = url.searchParams.get("error");
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state") ?? "";

        if (error) {
          finish(() => reject(new CodexAuthError(`ChatGPT sign-in failed: ${error}`)));
          return new Response(html("Sign-in failed", "Return to Rova and try again."), { status: 400, headers: { "Content-Type": "text/html" } });
        }

        const stateBuf = Buffer.from(returnedState);
        const expectedBuf = Buffer.from(state);
        const stateMatches = stateBuf.length === expectedBuf.length && timingSafeEqual(stateBuf, expectedBuf);
        if (!code || !stateMatches) {
          return new Response(html("Nothing waiting for this sign-in", "The sign-in may have timed out — return to Rova and start it again."), {
            status: 400,
            headers: { "Content-Type": "text/html" },
          });
        }

        exchangeAndSave(code, codeVerifier, userId)
          .then(() => finish(resolve))
          .catch((err) => finish(() => reject(err)));

        return new Response(html("Signed in", "You can close this tab and return to Rova."), { headers: { "Content-Type": "text/html" } });
      },
    });

    const timer = setTimeout(() => {
      finish(() => reject(new CodexAuthError("ChatGPT sign-in timed out after 5 minutes")));
    }, FLOW_TIMEOUT_MS);
    timer.unref?.();
  }).catch((err) => {
    const code = err instanceof Error && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
    const message = err instanceof Error ? err.message : String(err);
    if (code === "EADDRINUSE" || /in use|EADDRINUSE/i.test(message)) {
      throw new CodexAuthError(`Port ${CALLBACK_PORT} is already in use — quit whatever's holding it and try again.`);
    }
    throw err;
  });
}

async function exchangeAndSave(code: string, codeVerifier: string, userId: string): Promise<void> {
  const tokens = await tokenPost({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  });
  await upsertTokens(userId, tokens);
}

function html(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Rova</title>
<body style="font-family: system-ui; margin: 4rem auto; max-width: 28rem; text-align: center;">
<h2>${title}</h2><p>${body}</p></body>`;
}

// -- access token lookup / refresh --------------------------------------------

export interface ValidToken {
  accessToken: string;
  accountId: string;
}

/** `null` when the user has no ChatGPT connection at all. Refreshes proactively
 * when the stored access token is expired or near-expiry. This is the one
 * function every packet-generation call goes through (src/applications/codex.ts). */
export async function getValidAccessToken(userId: string): Promise<ValidToken | null> {
  const [row] = await db.select().from(chatgptConnections).where(eq(chatgptConnections.userId, userId)).limit(1);
  if (!row) return null;

  const exp = jwtClaims(row.accessToken).exp;
  const stale = typeof exp !== "number" || exp - Date.now() / 1000 < REFRESH_MARGIN_SECONDS;
  if (!stale) return { accessToken: row.accessToken, accountId: row.accountId };

  return refreshAccessToken(userId, row);
}

/** Forces a refresh regardless of the locally-decoded `exp` — used when the
 * backend itself has already rejected the current access token with a 401,
 * which our local staleness check can't have predicted (server-side
 * revocation, clock skew). */
export async function forceRefresh(userId: string): Promise<ValidToken | null> {
  const [row] = await db.select().from(chatgptConnections).where(eq(chatgptConnections.userId, userId)).limit(1);
  if (!row) return null;
  return refreshAccessToken(userId, row);
}

async function refreshAccessToken(
  userId: string,
  row: { accessToken: string; refreshToken: string; idToken: string; accountId: string },
): Promise<ValidToken | null> {
  let tokens: TokenResponseJson;
  try {
    tokens = await tokenPost({ grant_type: "refresh_token", refresh_token: row.refreshToken, client_id: CLIENT_ID });
  } catch {
    // A rejected/expired refresh token means the connection is dead — clear it
    // so the caller reads this as cleanly "not connected," not a crash loop.
    await disconnect(userId);
    return null;
  }
  await upsertTokens(userId, tokens, row);
  const [fresh] = await db.select().from(chatgptConnections).where(eq(chatgptConnections.userId, userId)).limit(1);
  if (!fresh) return null;
  return { accessToken: fresh.accessToken, accountId: fresh.accountId };
}

export async function disconnect(userId: string): Promise<void> {
  await db.delete(chatgptConnections).where(eq(chatgptConnections.userId, userId));
}

export async function getConnectionStatus(userId: string): Promise<{ connected: boolean; accountEmail: string | null }> {
  const [row] = await db.select({ accountEmail: chatgptConnections.accountEmail }).from(chatgptConnections).where(eq(chatgptConnections.userId, userId)).limit(1);
  return { connected: !!row, accountEmail: row?.accountEmail ?? null };
}
