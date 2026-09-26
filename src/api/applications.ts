import { createHash } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { and, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "@/auth/middleware";
import { requireAuth } from "@/auth/middleware";
import { generateAnswers, generateResumeAndCoverLetter, PacketGenerationNotConfiguredError } from "@/applications";
import { renderCoverLetterPdf, renderResumePdf } from "@/applications/pdf";
import { fetchApplicationQuestions } from "@/applications/questions";
import { env } from "@/config";
import { db } from "@/db/client";
import type { ApplicationStage, PacketAnswer } from "@/db/schema";
import { applicationPackets, candidateProfiles, companies, jobs, userJobActions } from "@/db/schema";
import { estimateCostUsd } from "@/ranking/claude";

type Job = typeof jobs.$inferSelect;
type Company = typeof companies.$inferSelect;
type CandidateProfile = typeof candidateProfiles.$inferSelect;

const generateSchema = z.object({ force: z.boolean().optional() });
const freeformAnswerSchema = z.object({ question: z.string().trim().min(1) });
const patchSchema = z.object({
  tailoredResumeText: z.string().optional(),
  coverLetterText: z.string().optional(),
  answers: z.array(z.object({ question: z.string(), answer: z.string(), source: z.enum(["fetched", "freeform"]) })).optional(),
});
const stageSchema = z.object({ stage: z.enum(["added", "ready", "applied"]) });

// hash(job.contentHash + profile inputs) — mirrors jobRankings.jobContentHash
// but also folds in profile/resume text, so editing your profile correctly
// marks existing packets stale too (jobRankings only tracks the job side).
function computePacketContentHash(jobContentHash: string, profileText: string, resumeText: string | null): string {
  return createHash("sha256").update([jobContentHash, profileText, resumeText ?? ""].join("|")).digest("hex");
}

function slugifyForFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "company";
}

// In-memory, per-row concurrency guard — not DB-persisted, so it can't
// permanently wedge a row if the process restarts mid-generation (same
// tradeoff family as admin.ts's crawlInProgress, but per packet instead
// of global).
const generatingPacketIds = new Set<string>();

// The guard above clears itself on restart, but the persisted
// `generationStatus` doesn't — a process killed mid-`runGeneration` (seen
// live under `bun --watch`, which restarts the whole process on every
// source edit) never reaches the success/failure branch that would
// update it, leaving the row stuck at "generating" forever: no in-memory
// guard blocks a fresh attempt, but the frontend's poll-while-generating
// UI never has a reason to stop waiting on the *old* attempt. Called once
// at process startup, before any request can start a *new* generation —
// at that point every "generating" row is unconditionally stale, since
// this fresh process's guard is still empty.
export async function reconcileInterruptedGenerations(): Promise<void> {
  const stuck = await db
    .update(applicationPackets)
    .set({ generationStatus: "failed", generationError: "generation was interrupted (server restarted) — try again", updatedAt: new Date() })
    .where(eq(applicationPackets.generationStatus, "generating"))
    .returning({ id: applicationPackets.id });
  if (stuck.length > 0) {
    console.warn(`[applications] reconciled ${stuck.length} packet(s) stuck in "generating" from an interrupted process`);
  }
}

interface RunGenerationInput {
  packetId: string;
  currentStage: ApplicationStage;
  job: Job;
  company: Company;
  profile: CandidateProfile;
  contentHash: string;
}

async function runGeneration(input: RunGenerationInput): Promise<void> {
  const { packetId, currentStage, job, company, profile, contentHash } = input;

  try {
    const questions = await fetchApplicationQuestions(company, job);

    const resumeResult = await generateResumeAndCoverLetter({
      profileText: profile.profileText,
      resumeText: profile.resumeText,
      jobTitle: job.title,
      companyName: company.name,
      location: job.location,
      description: job.description,
      userId: profile.userId,
    });
    if (!resumeResult.result) {
      throw new Error("resume/cover letter generation failed (refusal or an unparseable response)");
    }

    let answers: PacketAnswer[] = [];
    if (questions.length > 0) {
      const answersResult = await generateAnswers({
        profileText: profile.profileText,
        resumeText: profile.resumeText,
        jobTitle: job.title,
        companyName: company.name,
        questions,
        userId: profile.userId,
      });
      // A refusal/bad-shape answers response doesn't fail the whole
      // packet — the resume/cover letter already succeeded and are the
      // more important artifacts; answers just stays empty (the freeform
      // helper is still available from the frontend).
      if (answersResult.result) {
        const drafted = answersResult.result;
        answers = questions.map((q, i) => ({ question: q.label, answer: drafted[i]?.answer ?? "", source: "fetched" as const }));
      }
    }

    await db
      .update(applicationPackets)
      .set({
        tailoredResumeText: resumeResult.result.tailoredResumeText,
        coverLetterText: resumeResult.result.coverLetterText,
        answers,
        contentHash,
        generationStatus: "succeeded",
        generationError: null,
        generatedAt: new Date(),
        // Only auto-advance on the *first* successful generation — a
        // Regenerate on an already-ready/applied packet refreshes content
        // in place without moving the card.
        stage: currentStage === "added" ? "ready" : currentStage,
        updatedAt: new Date(),
      })
      .where(eq(applicationPackets.id, packetId));

    // estimateCostUsd is keyed off ANTHROPIC_MODEL pricing — only
    // meaningful when Claude actually generated this, not when
    // PACKET_GENERATION_PROVIDER=ollama (free, local).
    const cost = env.PACKET_GENERATION_PROVIDER === "claude" ? estimateCostUsd(resumeResult.inputTokens, resumeResult.outputTokens) : null;
    console.log(`[applications] generated packet ${packetId} via ${env.PACKET_GENERATION_PROVIDER}${cost !== null ? `: ~$${cost.toFixed(4)}` : ""}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(applicationPackets)
      .set({ generationStatus: "failed", generationError: message, updatedAt: new Date() })
      .where(eq(applicationPackets.id, packetId));
    throw error;
  }
}

export const applicationsRoutes = new Hono<AuthEnv>()
  .use(requireAuth)

  .post("/:jobId", async (c) => {
    const jobId = c.req.param("jobId");
    const user = c.get("user")!;

    const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return c.json({ error: "not found" }, 404);

    await db
      .insert(applicationPackets)
      .values({ userId: user.id, jobId })
      .onConflictDoNothing({ target: [applicationPackets.userId, applicationPackets.jobId] });

    const [packet] = await db
      .select()
      .from(applicationPackets)
      .where(and(eq(applicationPackets.userId, user.id), eq(applicationPackets.jobId, jobId)))
      .limit(1);

    return c.json({ packet });
  })

  // Removes the packet row, and clears a "saved" userJobActions state for
  // the same job — from the user's perspective, removing it from the
  // pipeline should undo "I'm interested in this," not leave a stray
  // Saved badge behind on the Jobs page. Deliberately leaves "dismissed"
  // and "applied" alone: those are separate, more deliberate signals
  // (rejecting the job / already applied) unrelated to being in-pipeline.
  .delete("/:jobId", async (c) => {
    const jobId = c.req.param("jobId");
    const user = c.get("user")!;

    const [deleted] = await db
      .delete(applicationPackets)
      .where(and(eq(applicationPackets.userId, user.id), eq(applicationPackets.jobId, jobId)))
      .returning({ id: applicationPackets.id });

    if (deleted) {
      await db
        .delete(userJobActions)
        .where(and(eq(userJobActions.userId, user.id), eq(userJobActions.jobId, jobId), eq(userJobActions.action, "saved")));
    }

    if (!deleted) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true });
  })

  .get("/", async (c) => {
    const user = c.get("user")!;

    const rows = await db
      .select({
        packet: applicationPackets,
        jobTitle: jobs.title,
        jobLocation: jobs.location,
        jobUrl: jobs.jobUrl,
        applyUrl: jobs.applyUrl,
        jobStatus: jobs.status,
        companyName: companies.name,
        companyDomain: companies.domain,
      })
      .from(applicationPackets)
      .innerJoin(jobs, eq(applicationPackets.jobId, jobs.id))
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(eq(applicationPackets.userId, user.id));

    return c.json({ packets: rows });
  })

  .get("/:jobId", async (c) => {
    const jobId = c.req.param("jobId");
    const user = c.get("user")!;

    const [row] = await db
      .select({ packet: applicationPackets, job: jobs, companyName: companies.name, companyDomain: companies.domain, ats: companies.ats })
      .from(applicationPackets)
      .innerJoin(jobs, eq(applicationPackets.jobId, jobs.id))
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(and(eq(applicationPackets.userId, user.id), eq(applicationPackets.jobId, jobId)))
      .limit(1);

    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(row);
  })

  .get("/:jobId/resume.pdf", async (c) => {
    const jobId = c.req.param("jobId");
    const user = c.get("user")!;

    const [row] = await db
      .select({ packet: applicationPackets, companyName: companies.name })
      .from(applicationPackets)
      .innerJoin(jobs, eq(applicationPackets.jobId, jobs.id))
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(and(eq(applicationPackets.userId, user.id), eq(applicationPackets.jobId, jobId)))
      .limit(1);

    if (!row || !row.packet.tailoredResumeText) return c.json({ error: "no resume generated yet for this job" }, 404);

    const pdfBytes = await renderResumePdf(row.packet.tailoredResumeText);
    return new Response(new Uint8Array(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="resume-${slugifyForFilename(row.companyName)}.pdf"`,
      },
    });
  })

  .get("/:jobId/cover-letter.pdf", async (c) => {
    const jobId = c.req.param("jobId");
    const user = c.get("user")!;

    const [row] = await db
      .select({ packet: applicationPackets, companyName: companies.name })
      .from(applicationPackets)
      .innerJoin(jobs, eq(applicationPackets.jobId, jobs.id))
      .innerJoin(companies, eq(jobs.companyId, companies.id))
      .where(and(eq(applicationPackets.userId, user.id), eq(applicationPackets.jobId, jobId)))
      .limit(1);

    if (!row || !row.packet.coverLetterText) return c.json({ error: "no cover letter generated yet for this job" }, 404);

    const pdfBytes = await renderCoverLetterPdf(row.packet.coverLetterText);
    return new Response(new Uint8Array(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="cover-letter-${slugifyForFilename(row.companyName)}.pdf"`,
      },
    });
  })

  .post("/:jobId/generate", zValidator("json", generateSchema), async (c) => {
    const jobId = c.req.param("jobId");
    const user = c.get("user")!;
    const { force } = c.req.valid("json");

    const [packet] = await db
      .select()
      .from(applicationPackets)
      .where(and(eq(applicationPackets.userId, user.id), eq(applicationPackets.jobId, jobId)))
      .limit(1);
    if (!packet) return c.json({ error: "add this job to your pipeline first" }, 404);

    if (generatingPacketIds.has(packet.id)) {
      return c.json({ error: "already generating" }, 409);
    }

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return c.json({ error: "job not found" }, 404);
    const [company] = await db.select().from(companies).where(eq(companies.id, job.companyId)).limit(1);
    if (!company) return c.json({ error: "company not found" }, 404);
    const [profile] = await db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, user.id)).limit(1);
    if (!profile) return c.json({ error: "save a profile first" }, 400);

    const contentHash = computePacketContentHash(job.contentHash, profile.profileText, profile.resumeText);

    if (!force && packet.contentHash === contentHash && packet.generationStatus === "succeeded") {
      return c.json({ packet, cached: true });
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(applicationPackets)
      .where(and(eq(applicationPackets.userId, user.id), gt(applicationPackets.generatedAt, startOfDay)));
    if ((row?.count ?? 0) >= env.MAX_PACKET_GENERATIONS_PER_DAY) {
      return c.json({ error: "daily packet generation limit reached" }, 429);
    }

    generatingPacketIds.add(packet.id);
    await db
      .update(applicationPackets)
      .set({ generationStatus: "generating", generationError: null, updatedAt: new Date() })
      .where(eq(applicationPackets.id, packet.id));

    runGeneration({ packetId: packet.id, currentStage: packet.stage, job, company, profile, contentHash })
      .catch((error) => console.error(`[applications] packet generation failed for ${packet.id}:`, error))
      .finally(() => generatingPacketIds.delete(packet.id));

    return c.json({ ok: true, started: true });
  })

  .post("/:jobId/questions/answer", zValidator("json", freeformAnswerSchema), async (c) => {
    const jobId = c.req.param("jobId");
    const user = c.get("user")!;
    const { question } = c.req.valid("json");

    const [packet] = await db
      .select()
      .from(applicationPackets)
      .where(and(eq(applicationPackets.userId, user.id), eq(applicationPackets.jobId, jobId)))
      .limit(1);
    if (!packet) return c.json({ error: "add this job to your pipeline first" }, 404);

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return c.json({ error: "job not found" }, 404);
    const [company] = await db.select().from(companies).where(eq(companies.id, job.companyId)).limit(1);
    const [profile] = await db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, user.id)).limit(1);
    if (!profile) return c.json({ error: "save a profile first" }, 400);

    let answerText: string;
    try {
      const result = await generateAnswers({
        profileText: profile.profileText,
        resumeText: profile.resumeText,
        jobTitle: job.title,
        companyName: company?.name ?? "",
        questions: [{ label: question, description: null, required: false }],
        userId: user.id,
      });
      answerText = result.result?.[0]?.answer ?? "";
    } catch (error) {
      if (error instanceof PacketGenerationNotConfiguredError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }

    if (!answerText) return c.json({ error: "couldn't draft an answer for that question" }, 502);

    const updatedAnswers: PacketAnswer[] = [...packet.answers, { question, answer: answerText, source: "freeform" }];
    await db.update(applicationPackets).set({ answers: updatedAnswers, updatedAt: new Date() }).where(eq(applicationPackets.id, packet.id));

    return c.json({ answers: updatedAnswers });
  })

  .patch("/:jobId", zValidator("json", patchSchema), async (c) => {
    const jobId = c.req.param("jobId");
    const user = c.get("user")!;
    const updates = c.req.valid("json");

    if (Object.keys(updates).length === 0) return c.json({ error: "nothing to update" }, 400);

    // Deliberately doesn't touch contentHash/generationStatus — a manual
    // edit must survive until the user explicitly clicks Regenerate.
    const [updated] = await db
      .update(applicationPackets)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(applicationPackets.userId, user.id), eq(applicationPackets.jobId, jobId)))
      .returning();

    if (!updated) return c.json({ error: "not found" }, 404);
    return c.json({ packet: updated });
  })

  .post("/:jobId/stage", zValidator("json", stageSchema), async (c) => {
    const jobId = c.req.param("jobId");
    const user = c.get("user")!;
    const { stage } = c.req.valid("json");

    const [packet] = await db
      .select()
      .from(applicationPackets)
      .where(and(eq(applicationPackets.userId, user.id), eq(applicationPackets.jobId, jobId)))
      .limit(1);
    if (!packet) return c.json({ error: "not found" }, 404);

    if (stage === "applied" && packet.generationStatus !== "succeeded") {
      return c.json({ error: "generate a packet before marking this applied" }, 400);
    }

    const [updated] = await db
      .update(applicationPackets)
      .set({ stage, updatedAt: new Date() })
      .where(eq(applicationPackets.id, packet.id))
      .returning();

    if (stage === "applied") {
      await db
        .insert(userJobActions)
        .values({ userId: user.id, jobId, action: "applied" })
        .onConflictDoUpdate({
          target: [userJobActions.userId, userJobActions.jobId],
          set: { action: "applied", createdAt: new Date() },
        });
    }

    return c.json({ packet: updated });
  });
