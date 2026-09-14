import { Hono } from "hono";
import { logger } from "hono/logger";
import indexHtml from "@/web/index.html";
import type { AuthEnv } from "@/auth/middleware";
import { attachSession } from "@/auth/middleware";
import { adminRoutes } from "@/api/admin";
import { applicationsRoutes, reconcileInterruptedGenerations } from "@/api/applications";
import { authRoutes } from "@/api/auth";
import { discoveryRoutes } from "@/api/discovery";
import { jobsRoutes } from "@/api/jobs";
import { profileRoutes } from "@/api/profile";
import { env } from "@/config";

export function createApp() {
  const app = new Hono<AuthEnv>();

  app.use("*", logger());
  app.use("*", attachSession);

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/auth", authRoutes);
  app.route("/api/profile", profileRoutes);
  app.route("/api/jobs", jobsRoutes);
  app.route("/api/applications", applicationsRoutes);
  app.route("/api/admin", adminRoutes);
  app.route("/api/admin", discoveryRoutes);

  return app;
}

export async function serve() {
  const app = createApp();

  await reconcileInterruptedGenerations();

  const server = Bun.serve({
    port: env.PORT,
    routes: {
      "/api/*": (req, bunServer) => app.fetch(req, bunServer),
      "/*": indexHtml,
    },
    development: env.NODE_ENV !== "production" && { hmr: true, console: true },
  });

  console.log(`rova serve listening on ${server.url}`);
  return server;
}
