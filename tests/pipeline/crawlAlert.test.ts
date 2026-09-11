import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { env } from "@/config";
import { db } from "@/db/client";
import { companies, crawlRuns } from "@/db/schema";
import { checkConsecutiveFailuresAndAlert } from "@/pipeline/crawl";

const originalFetch = globalThis.fetch;
const originalAdminEmail = env.ADMIN_EMAIL;
const originalResendKey = env.RESEND_API_KEY;

describe("checkConsecutiveFailuresAndAlert", () => {
  const marker = crypto.randomUUID().slice(0, 8);
  let company: typeof companies.$inferSelect;

  beforeAll(async () => {
    const [c] = await db
      .insert(companies)
      .values({
        name: `Alert Co ${marker}`,
        slug: `alert-co-${marker}`,
        ats: "greenhouse",
        atsIdentifier: `alert-co-${marker}`,
      })
      .returning();
    company = c!;
  });

  afterAll(async () => {
    await db.delete(crawlRuns).where(eq(crawlRuns.companyId, company.id));
    await db.delete(companies).where(eq(companies.id, company.id));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    env.ADMIN_EMAIL = originalAdminEmail;
    env.RESEND_API_KEY = originalResendKey;
    await db.delete(crawlRuns).where(eq(crawlRuns.companyId, company.id));
  });

  async function seedRuns(statuses: ("success" | "failed")[]) {
    // Oldest first, spaced a second apart so ORDER BY started_at is unambiguous.
    for (let i = 0; i < statuses.length; i++) {
      await db.insert(crawlRuns).values({
        companyId: company.id,
        status: statuses[i]!,
        startedAt: new Date(Date.now() - (statuses.length - i) * 1000),
        finishedAt: new Date(Date.now() - (statuses.length - i) * 1000 + 500),
      });
    }
  }

  it("does not alert below the threshold", async () => {
    await seedRuns(["failed", "failed"]); // only 2, threshold is 3
    env.ADMIN_EMAIL = "admin@example.test";
    let called = false;
    globalThis.fetch = mock(async () => {
      called = true;
      return Response.json({ id: "x" });
    }) as unknown as typeof fetch;

    await checkConsecutiveFailuresAndAlert(company);
    expect(called).toBe(false);
  });

  it("logs a warning instead of sending when ADMIN_EMAIL is unset", async () => {
    await seedRuns(["failed", "failed", "failed"]);
    env.ADMIN_EMAIL = undefined;
    let called = false;
    globalThis.fetch = mock(async () => {
      called = true;
      return Response.json({ id: "x" });
    }) as unknown as typeof fetch;

    await checkConsecutiveFailuresAndAlert(company); // must not throw
    expect(called).toBe(false);
  });

  it("sends exactly once when crossing the threshold, and not again on the next failure", async () => {
    env.ADMIN_EMAIL = "admin@example.test";
    env.RESEND_API_KEY = "test-key";
    let sendCount = 0;
    globalThis.fetch = mock(async () => {
      sendCount += 1;
      return Response.json({ id: "email_1" });
    }) as unknown as typeof fetch;

    await seedRuns(["success", "failed", "failed", "failed"]); // crosses at the 3rd consecutive failure
    await checkConsecutiveFailuresAndAlert(company);
    expect(sendCount).toBe(1);

    // A 4th consecutive failure shouldn't re-alert (already alerted at the
    // previous threshold crossing).
    await db.insert(crawlRuns).values({ companyId: company.id, status: "failed", startedAt: new Date() });
    await checkConsecutiveFailuresAndAlert(company);
    expect(sendCount).toBe(1);
  });

  it("never throws even if sending fails", async () => {
    await seedRuns(["failed", "failed", "failed"]);
    env.ADMIN_EMAIL = "admin@example.test";
    env.RESEND_API_KEY = "test-key";
    globalThis.fetch = mock(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;

    await expect(checkConsecutiveFailuresAndAlert(company)).resolves.toBeUndefined();
  });
});
