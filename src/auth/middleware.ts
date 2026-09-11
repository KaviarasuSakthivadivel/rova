import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { env } from "@/config";
import { type AuthedUser, SESSION_COOKIE, validateSession } from "./session";

export type AuthEnv = { Variables: { user: AuthedUser | null } };

export function setSessionCookie(c: Context, token: string, expiresAt: Date) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Runs on every request — attaches the current user (or null) to context
 * without rejecting, so public routes can still read `c.get("user")`. */
export async function attachSession(c: Context<AuthEnv>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    c.set("user", null);
    return next();
  }

  const result = await validateSession(token);
  if (!result) {
    c.set("user", null);
    return next();
  }

  c.set("user", result.user);
  if (result.renewedExpiresAt) {
    setSessionCookie(c, token, result.renewedExpiresAt);
  }
  return next();
}

/** Mount after attachSession on any route that requires a logged-in user. */
export async function requireAuth(c: Context<AuthEnv>, next: Next) {
  if (!c.get("user")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
}
