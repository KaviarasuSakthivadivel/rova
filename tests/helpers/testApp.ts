import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createApp } from "@/server";

export function testApp() {
  return createApp();
}

export function uniqueEmail(label: string): string {
  return `test-${label}-${crypto.randomUUID()}@example.test`;
}

export function extractCookie(response: Response): string {
  const raw = response.headers.get("set-cookie");
  if (!raw) throw new Error("expected a Set-Cookie header on the response");
  return raw.split(";")[0] ?? "";
}

export async function deleteTestUser(email: string): Promise<void> {
  await db.delete(users).where(eq(users.email, email));
}
