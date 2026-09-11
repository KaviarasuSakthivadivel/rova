import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "@/auth/middleware";
import { requireAuth } from "@/auth/middleware";
import { db } from "@/db/client";
import { candidateProfiles } from "@/db/schema";
import { embedText, EmbeddingsNotConfiguredError } from "@/embeddings/openai";
import { extractResumeText, ResumeTooLargeError, UnsupportedResumeTypeError } from "@/resume/extract";

const preferencesSchema = z.object({
  locations: z.array(z.string()).optional(),
  remoteOk: z.boolean().optional(),
  seniority: z.array(z.string()).optional(),
  compFloor: z.number().optional(),
});

const profileSchema = z.object({
  profileText: z.string().min(1),
  resumeText: z.string().optional(),
  preferences: preferencesSchema.optional(),
});

/** Embed-on-save (PRD.md §4), combining "about you" and resume text into
 * one signal. Never lets a missing/failing embeddings provider block
 * saving the profile itself — logs and returns null, same discipline as
 * the crawler/digest stages. */
async function tryEmbed(profileText: string, resumeText: string | undefined): Promise<number[] | null> {
  const combined = [profileText, resumeText].filter(Boolean).join("\n\n");
  try {
    return await embedText(combined);
  } catch (error) {
    if (error instanceof EmbeddingsNotConfiguredError) {
      console.warn("[profile] OPENAI_API_KEY not set — saving profile without an embedding");
    } else {
      console.error("[profile] embedding generation failed:", error);
    }
    return null;
  }
}

export const profileRoutes = new Hono<AuthEnv>()
  .use(requireAuth)

  .get("/", async (c) => {
    const user = c.get("user")!;

    const [profile] = await db
      .select()
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, user.id))
      .limit(1);

    return c.json({ profile: profile ?? null });
  })

  .put("/", zValidator("json", profileSchema), async (c) => {
    const user = c.get("user")!;
    const { profileText, resumeText, preferences } = c.req.valid("json");
    const embedding = await tryEmbed(profileText, resumeText);

    const [existing] = await db
      .select({ id: candidateProfiles.id })
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, user.id))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(candidateProfiles)
        .set({ profileText, resumeText, preferences: preferences ?? {}, embedding, updatedAt: new Date() })
        .where(eq(candidateProfiles.id, existing.id))
        .returning();
      return c.json({ profile: updated });
    }

    const [created] = await db
      .insert(candidateProfiles)
      .values({ userId: user.id, profileText, resumeText, preferences: preferences ?? {}, embedding })
      .returning();
    return c.json({ profile: created }, 201);
  })

  // Upload a resume (PDF or .txt), get back extracted plain text. The
  // client shows it for review/editing and includes it in the next PUT —
  // this endpoint only extracts, it doesn't save anything itself.
  .post("/resume", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;

    if (!(file instanceof File)) {
      return c.json({ error: "no file uploaded (expected form field \"file\")" }, 400);
    }

    try {
      const resumeText = await extractResumeText(file);
      if (!resumeText) {
        return c.json({ error: "couldn't extract any text from that file" }, 422);
      }
      return c.json({ resumeText });
    } catch (error) {
      if (error instanceof UnsupportedResumeTypeError || error instanceof ResumeTooLargeError) {
        return c.json({ error: error.message }, 400);
      }
      console.error("[profile] resume extraction failed:", error);
      return c.json({ error: "failed to extract text from that file" }, 500);
    }
  });
