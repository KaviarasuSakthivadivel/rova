import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000; // renew if < 15 days left

export const SESSION_COOKIE = "rova_session";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cookie holds the raw token; only its hash is ever persisted, so a DB
 * leak doesn't hand out usable session tokens. */
export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });

  return { token, expiresAt };
}

export interface AuthedUser {
  id: string;
  email: string;
}

export async function validateSession(
  token: string,
): Promise<{ user: AuthedUser; renewedExpiresAt: Date | null } | null> {
  const id = hashToken(token);

  const [row] = await db
    .select({ userId: users.id, email: users.email, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;

  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  let renewedExpiresAt: Date | null = null;
  if (row.expiresAt.getTime() - Date.now() < RENEW_THRESHOLD_MS) {
    renewedExpiresAt = new Date(Date.now() + SESSION_DURATION_MS);
    await db.update(sessions).set({ expiresAt: renewedExpiresAt }).where(eq(sessions.id, id));
  }

  return { user: { id: row.userId, email: row.email }, renewedExpiresAt };
}

export async function invalidateSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}
