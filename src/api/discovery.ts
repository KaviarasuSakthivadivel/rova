import { zValidator } from "@hono/zod-validator";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "@/auth/middleware";
import { requireAdmin } from "@/auth/middleware";
import { db } from "@/db/client";
import { companies, companyDiscoveryCandidates } from "@/db/schema";
import { runDiscovery } from "@/pipeline/discover";

const discoverSchema = z.object({
  companies: z
    .array(z.object({ name: z.string().min(1) }))
    .min(1)
    .max(50),
});

function boardUrlFor(ats: string, identifier: string): string | undefined {
  switch (ats) {
    case "greenhouse":
      return `https://boards.greenhouse.io/${identifier}`;
    case "lever":
      return `https://jobs.lever.co/${identifier}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${identifier}`;
    case "smartrecruiters":
      return `https://jobs.smartrecruiters.com/${identifier}`;
    default:
      return undefined;
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export const discoveryRoutes = new Hono<AuthEnv>()
  .use(requireAdmin)

  .post("/discover", zValidator("json", discoverSchema), async (c) => {
    const { companies: names } = c.req.valid("json");
    const results = await runDiscovery(names.map((n) => n.name));
    return c.json({ results });
  })

  .get("/discovery-candidates", async (c) => {
    const candidates = await db
      .select()
      .from(companyDiscoveryCandidates)
      .where(eq(companyDiscoveryCandidates.status, "pending"));
    return c.json({ candidates });
  })

  .post("/discovery-candidates/:id/approve", async (c) => {
    const id = c.req.param("id");

    const [candidate] = await db
      .select()
      .from(companyDiscoveryCandidates)
      .where(eq(companyDiscoveryCandidates.id, id))
      .limit(1);
    if (!candidate) return c.json({ error: "not found" }, 404);

    const ats = candidate.guessedAts;
    const identifier = candidate.guessedIdentifier;
    if (!ats || !identifier || !["greenhouse", "lever", "ashby", "smartrecruiters"].includes(ats)) {
      return c.json({ error: "candidate has no usable ATS guess to promote" }, 400);
    }

    await db
      .insert(companies)
      .values({
        name: candidate.name,
        slug: slugify(candidate.name),
        ats,
        atsIdentifier: identifier,
        careersUrl: boardUrlFor(ats, identifier),
        domain: candidate.domain,
      })
      .onConflictDoNothing({ target: [companies.ats, companies.atsIdentifier] });

    await db.update(companyDiscoveryCandidates).set({ status: "approved" }).where(eq(companyDiscoveryCandidates.id, id));

    return c.json({ ok: true });
  })

  .post("/discovery-candidates/:id/reject", async (c) => {
    const id = c.req.param("id");

    const [updated] = await db
      .update(companyDiscoveryCandidates)
      .set({ status: "rejected" })
      .where(eq(companyDiscoveryCandidates.id, id))
      .returning({ id: companyDiscoveryCandidates.id });

    if (!updated) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  })

  .get("/companies", async (c) => {
    const rows = await db.select().from(companies).orderBy(asc(companies.name));
    return c.json({ companies: rows });
  })

  // Soft-remove, not a delete: companies.id cascades to jobs and
  // everything hanging off them (snapshots, saved/dismissed actions,
  // rankings, application packets) — a hard delete here would silently
  // wipe a user's saved jobs and pipeline history for this company. This
  // just excludes it from future crawls (runCrawl only iterates active
  // companies); its existing jobs stay exactly as they are.
  .post("/companies/:id/deactivate", async (c) => {
    const id = c.req.param("id");
    const [updated] = await db.update(companies).set({ active: false, updatedAt: new Date() }).where(eq(companies.id, id)).returning();
    if (!updated) return c.json({ error: "not found" }, 404);
    return c.json({ company: updated });
  })

  .post("/companies/:id/reactivate", async (c) => {
    const id = c.req.param("id");
    const [updated] = await db.update(companies).set({ active: true, updatedAt: new Date() }).where(eq(companies.id, id)).returning();
    if (!updated) return c.json({ error: "not found" }, 404);
    return c.json({ company: updated });
  });
