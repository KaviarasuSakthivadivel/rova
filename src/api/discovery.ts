import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
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
    if (!ats || !identifier || !["greenhouse", "lever", "ashby"].includes(ats)) {
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
  });
