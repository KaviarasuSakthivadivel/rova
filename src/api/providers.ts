import { Hono } from "hono";
import type { AuthEnv } from "@/auth/middleware";
import { requireAuth } from "@/auth/middleware";
import { buildAuthorizeUrl, disconnect, getConnectionStatus, runLoopbackFlow } from "@/applications/codexAuth";
import { env } from "@/config";

// Port 1455 (the loopback OAuth callback) is a single OS-level resource, so
// only one connect flow can be in flight at a time regardless of which Rova
// user starts it — a module-level guard, not per-user. Rova is fundamentally
// single-operator in practice today; this is a deliberate simplification.
let activeConnectFlow: { userId: string; startedAt: number } | null = null;

export const providersRoutes = new Hono<AuthEnv>()
  .use(requireAuth)

  .post("/codex/connect", async (c) => {
    const user = c.get("user")!;

    if (activeConnectFlow) {
      return c.json({ error: "a ChatGPT connection attempt is already in progress" }, 409);
    }

    const { url, codeVerifier, state } = buildAuthorizeUrl();
    activeConnectFlow = { userId: user.id, startedAt: Date.now() };

    runLoopbackFlow({ codeVerifier, state, userId: user.id })
      .catch((error) => console.error(`[providers] ChatGPT connect flow failed for user ${user.id}:`, error))
      .finally(() => {
        activeConnectFlow = null;
      });

    return c.json({ authorizeUrl: url });
  })

  .get("/codex/status", async (c) => {
    const user = c.get("user")!;
    const active = env.PACKET_GENERATION_PROVIDER === "codex";
    const { connected, accountEmail } = await getConnectionStatus(user.id);
    const connecting = activeConnectFlow?.userId === user.id;

    return c.json({ active, connected, connecting, accountEmail });
  })

  .post("/codex/disconnect", async (c) => {
    const user = c.get("user")!;
    await disconnect(user.id);
    return c.json({ ok: true });
  });
