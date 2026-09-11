import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import type { AuthEnv } from "@/auth/middleware";
import { clearSessionCookie, setSessionCookie } from "@/auth/middleware";
import { hashPassword, verifyPassword } from "@/auth/password";
import { createSession, invalidateSession, SESSION_COOKIE } from "@/auth/session";
import { db } from "@/db/client";
import { users } from "@/db/schema";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "password must be at least 8 characters"),
});

export const authRoutes = new Hono<AuthEnv>()
  .post("/signup", zValidator("json", credentialsSchema), async (c) => {
    const { email, password } = c.req.valid("json");

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      return c.json({ error: "an account with that email already exists" }, 409);
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db.insert(users).values({ email, passwordHash }).returning({ id: users.id, email: users.email });
    if (!user) {
      return c.json({ error: "failed to create account" }, 500);
    }

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(c, token, expiresAt);

    return c.json({ user: { id: user.id, email: user.email } }, 201);
  })

  .post("/login", zValidator("json", credentialsSchema), async (c) => {
    const { email, password } = c.req.valid("json");

    const [user] = await db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return c.json({ error: "invalid email or password" }, 401);
    }

    const { token, expiresAt } = await createSession(user.id);
    setSessionCookie(c, token, expiresAt);

    return c.json({ user: { id: user.id, email: user.email } });
  })

  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await invalidateSession(token);
    clearSessionCookie(c);
    return c.json({ ok: true });
  })

  .get("/me", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ user: null }, 200);
    return c.json({ user });
  });
