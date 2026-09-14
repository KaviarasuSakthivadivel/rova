import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { companies, jobs } from "@/db/schema";

// generateResumeAndCoverLetter/generateAnswers would otherwise hit a real
// Anthropic API — mock the module so this test exercises the route's own
// logic (auth, the add-to-pipeline/generate/stage state machine, the
// content-hash cache, the concurrency guard) without a live LLM call.
// mock.module works retroactively even though src/api/applications.ts
// statically imports the real module, as long as the modules that
// transitively pull it in are loaded via a dynamic `await import()`
// *after* this call — see tests/api/adminCrawl.test.ts for the same trick.
let resumeCallCount = 0;
let hangForever = false;

class MockPacketGenerationNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured");
  }
}

mock.module("@/applications", () => ({
  PacketGenerationNotConfiguredError: MockPacketGenerationNotConfiguredError,
  generateResumeAndCoverLetter: mock(async () => {
    resumeCallCount += 1;
    if (hangForever) return new Promise(() => {}); // never resolves — keeps "generating" stable for the guard test
    return {
      result: { tailoredResumeText: "TEST TAILORED RESUME", coverLetterText: "Test cover letter." },
      inputTokens: 100,
      outputTokens: 50,
    };
  }),
  generateAnswers: mock(async () => ({ result: [{ answer: "A grounded test answer." }], inputTokens: 20, outputTokens: 10 })),
}));

async function waitForGenerationToFinish(app: ReturnType<typeof import("../helpers/testApp").testApp>, jobId: string, cookie: string) {
  for (let i = 0; i < 50; i++) {
    const res = await app.request(`/api/applications/${jobId}`, { headers: { Cookie: cookie } });
    const body = await res.json();
    if (body.packet.generationStatus !== "generating") return body;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("generation never finished");
}

describe("applications routes", () => {
  const marker = crypto.randomUUID().slice(0, 8);
  let companyId: string;
  let jobId: string;

  beforeAll(async () => {
    // Lever, not Greenhouse — fetchApplicationQuestions returns [] without
    // any network call, so this test doesn't need to also mock
    // @/applications/questions.
    const [company] = await db
      .insert(companies)
      .values({ name: `Test Co ${marker}`, slug: `test-co-apps-${marker}`, ats: "lever", atsIdentifier: `test-co-apps-${marker}` })
      .returning({ id: companies.id });
    companyId = company!.id;
  });

  afterAll(async () => {
    await db.delete(jobs).where(eq(jobs.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
  });

  it("runs the full add -> generate -> ready -> applied lifecycle", async () => {
    const { deleteTestUser, extractCookie, testApp, uniqueEmail } = await import("../helpers/testApp");
    const app = testApp();
    const email = uniqueEmail("applications");

    const [job] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "lever",
        externalId: `ext-apps-${marker}`,
        title: "Applications Test Engineer",
        description: "A job used only by this test.",
        jobUrl: "https://example.test/job",
        status: "OPEN",
        contentHash: `hash-apps-${marker}`,
      })
      .returning({ id: jobs.id });
    jobId = job!.id;

    const signupRes = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    const cookie = extractCookie(signupRes);

    // Unauthenticated
    const unauth = await app.request(`/api/applications/${jobId}`, { method: "POST" });
    expect(unauth.status).toBe(401);

    // Generating before adding to the pipeline is a 404, not an implicit add
    const tooEarly = await app.request(`/api/applications/${jobId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "{}",
    });
    expect(tooEarly.status).toBe(404);

    // Add to pipeline — idempotent
    const add1 = await app.request(`/api/applications/${jobId}`, { method: "POST", headers: { Cookie: cookie } });
    expect(add1.status).toBe(200);
    const add2 = await app.request(`/api/applications/${jobId}`, { method: "POST", headers: { Cookie: cookie } });
    expect((await add2.json()).packet.stage).toBe("added");

    const listed = await app.request("/api/applications", { headers: { Cookie: cookie } });
    const listedPackets = (await listed.json()).packets;
    const listedEntry = listedPackets.find((p: { packet: { jobId: string } }) => p.packet.jobId === jobId);
    expect(listedEntry).toBeTruthy();
    expect(listedEntry.jobStatus).toBe("OPEN");

    // No PDF before a packet has ever been generated
    const tooEarlyPdf = await app.request(`/api/applications/${jobId}/resume.pdf`, { headers: { Cookie: cookie } });
    expect(tooEarlyPdf.status).toBe(404);

    // No profile yet -> generate should 400, not crash
    const noProfile = await app.request(`/api/applications/${jobId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "{}",
    });
    expect(noProfile.status).toBe(400);

    await app.request("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ profileText: "Backend engineer. Java, Kafka, AWS." }),
    });

    // Generate — fire and forget, then poll until it's done
    const genRes = await app.request(`/api/applications/${jobId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "{}",
    });
    expect(genRes.status).toBe(200);
    expect(await genRes.json()).toEqual({ ok: true, started: true });

    const finished = await waitForGenerationToFinish(app, jobId, cookie);
    expect(finished.packet.generationStatus).toBe("succeeded");
    expect(finished.packet.tailoredResumeText).toBe("TEST TAILORED RESUME");
    expect(finished.packet.coverLetterText).toBe("Test cover letter.");
    expect(finished.packet.answers).toEqual([]); // Lever -> no fetched questions
    expect(finished.packet.stage).toBe("ready"); // auto-advanced on first success
    expect(finished.ats).toBe("lever");

    // Real PDF downloads once content exists
    const resumePdf = await app.request(`/api/applications/${jobId}/resume.pdf`, { headers: { Cookie: cookie } });
    expect(resumePdf.status).toBe(200);
    expect(resumePdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await resumePdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");

    const coverLetterPdf = await app.request(`/api/applications/${jobId}/cover-letter.pdf`, { headers: { Cookie: cookie } });
    expect(coverLetterPdf.status).toBe(200);
    expect(coverLetterPdf.headers.get("content-type")).toBe("application/pdf");

    // Regenerate without force + unchanged content -> cached, no new LLM call
    const callsBeforeCache = resumeCallCount;
    const cached = await app.request(`/api/applications/${jobId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "{}",
    });
    expect((await cached.json()).cached).toBe(true);
    expect(resumeCallCount).toBe(callsBeforeCache);

    // Manual edit (PATCH) persists and doesn't reset generationStatus
    const patchRes = await app.request(`/api/applications/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ coverLetterText: "Hand-edited cover letter." }),
    });
    expect((await patchRes.json()).packet.coverLetterText).toBe("Hand-edited cover letter.");
    const afterPatch = await app.request(`/api/applications/${jobId}`, { headers: { Cookie: cookie } });
    expect((await afterPatch.json()).packet.generationStatus).toBe("succeeded");

    // Freeform Q&A helper
    const freeform = await app.request(`/api/applications/${jobId}/questions/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ question: "Why do you want to work here?" }),
    });
    expect(freeform.status).toBe(200);
    const freeformBody = await freeform.json();
    expect(freeformBody.answers).toHaveLength(1);
    expect(freeformBody.answers[0]).toEqual({ question: "Why do you want to work here?", answer: "A grounded test answer.", source: "freeform" });

    // Can't mark applied before... oh wait, it's already succeeded — verify
    // that a *fresh* packet without a successful generation is blocked.
    const [freshJob] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "lever",
        externalId: `ext-apps-fresh-${marker}`,
        title: "Fresh Test Job",
        jobUrl: "https://example.test/fresh",
        status: "OPEN",
        contentHash: `hash-apps-fresh-${marker}`,
      })
      .returning({ id: jobs.id });
    await app.request(`/api/applications/${freshJob!.id}`, { method: "POST", headers: { Cookie: cookie } });
    const blockedApply = await app.request(`/api/applications/${freshJob!.id}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ stage: "applied" }),
    });
    expect(blockedApply.status).toBe(400);

    // Move the generated packet to applied — cross-wires userJobActions
    const applyRes = await app.request(`/api/applications/${jobId}/stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ stage: "applied" }),
    });
    expect(applyRes.status).toBe(200);
    expect((await applyRes.json()).packet.stage).toBe("applied");

    const jobDetail = await app.request(`/api/jobs/${jobId}`, { headers: { Cookie: cookie } });
    expect((await jobDetail.json()).action).toBe("applied");

    await db.delete(jobs).where(eq(jobs.id, freshJob!.id));
    await deleteTestUser(email);
  });

  it("removes a packet from the pipeline without touching the job itself", async () => {
    const { deleteTestUser, extractCookie, testApp, uniqueEmail } = await import("../helpers/testApp");
    const app = testApp();
    const email = uniqueEmail("applications-remove");

    const [job] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "lever",
        externalId: `ext-apps-remove-${marker}`,
        title: "Remove Test Job",
        jobUrl: "https://example.test/remove",
        status: "OPEN",
        contentHash: `hash-apps-remove-${marker}`,
      })
      .returning({ id: jobs.id });

    const signupRes = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    const cookie = extractCookie(signupRes);

    const unauth = await app.request(`/api/applications/${job!.id}`, { method: "DELETE" });
    expect(unauth.status).toBe(401);

    const notYetAdded = await app.request(`/api/applications/${job!.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(notYetAdded.status).toBe(404);

    await app.request(`/api/applications/${job!.id}`, { method: "POST", headers: { Cookie: cookie } });

    // Saving the job (e.g. from the Jobs page) shouldn't survive removal —
    // from the user's perspective "remove from pipeline" undoes "I'm
    // interested in this," not leave a stray Saved badge behind.
    await app.request(`/api/jobs/${job!.id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ action: "saved" }),
    });

    const removeRes = await app.request(`/api/applications/${job!.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(removeRes.status).toBe(200);
    expect(await removeRes.json()).toEqual({ ok: true });

    const afterRemove = await app.request(`/api/applications/${job!.id}`, { headers: { Cookie: cookie } });
    expect(afterRemove.status).toBe(404); // packet gone

    const jobAfterRemove = await app.request(`/api/jobs/${job!.id}`, { headers: { Cookie: cookie } });
    expect(jobAfterRemove.status).toBe(200); // job itself untouched
    expect((await jobAfterRemove.json()).action).toBeNull(); // "saved" cleared too

    const removeAgain = await app.request(`/api/applications/${job!.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(removeAgain.status).toBe(404);

    await db.delete(jobs).where(eq(jobs.id, job!.id));
    await deleteTestUser(email);
  });

  it("rejects a concurrent generate on the same packet with 409", async () => {
    const { deleteTestUser, extractCookie, testApp, uniqueEmail } = await import("../helpers/testApp");
    const app = testApp();
    const email = uniqueEmail("applications-guard");

    const [job] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "lever",
        externalId: `ext-apps-guard-${marker}`,
        title: "Guard Test Job",
        jobUrl: "https://example.test/guard",
        status: "OPEN",
        contentHash: `hash-apps-guard-${marker}`,
      })
      .returning({ id: jobs.id });

    const signupRes = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    const cookie = extractCookie(signupRes);
    await app.request("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ profileText: "test profile" }),
    });
    await app.request(`/api/applications/${job!.id}`, { method: "POST", headers: { Cookie: cookie } });

    hangForever = true;
    try {
      const first = await app.request(`/api/applications/${job!.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: "{}",
      });
      expect(first.status).toBe(200);

      const second = await app.request(`/api/applications/${job!.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: "{}",
      });
      expect(second.status).toBe(409);
    } finally {
      hangForever = false;
    }

    await db.delete(jobs).where(eq(jobs.id, job!.id));
    await deleteTestUser(email);
  });

  it("reconcileInterruptedGenerations fails packets stuck in 'generating' from a killed process", async () => {
    // Regression test: a real generation got killed mid-flight (the dev
    // server restarts on every file save under `bun --watch`), leaving a
    // packet's generationStatus stuck at "generating" forever — no
    // in-memory guard blocks a fresh process from starting a new
    // generation, but nothing was ever going to move that persisted
    // status off "generating" either, so the frontend's poll-while-
    // generating UI waited on a generation that would never finish.
    const { deleteTestUser, extractCookie, testApp, uniqueEmail } = await import("../helpers/testApp");
    const { reconcileInterruptedGenerations } = await import("@/api/applications");
    const app = testApp();
    const email = uniqueEmail("applications-reconcile");

    const [job] = await db
      .insert(jobs)
      .values({
        companyId,
        source: "lever",
        externalId: `ext-apps-reconcile-${marker}`,
        title: "Reconcile Test Job",
        jobUrl: "https://example.test/reconcile",
        status: "OPEN",
        contentHash: `hash-apps-reconcile-${marker}`,
      })
      .returning({ id: jobs.id });

    const signupRes = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    const cookie = extractCookie(signupRes);
    await app.request("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ profileText: "test profile" }),
    });
    await app.request(`/api/applications/${job!.id}`, { method: "POST", headers: { Cookie: cookie } });

    hangForever = true;
    try {
      const started = await app.request(`/api/applications/${job!.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: "{}",
      });
      expect(started.status).toBe(200);

      // Simulates the process being killed: nothing will ever resolve the
      // in-flight promise above, so the row is left at "generating" —
      // exactly the state a real restart leaves behind.
      await reconcileInterruptedGenerations();

      const after = await app.request(`/api/applications/${job!.id}`, { headers: { Cookie: cookie } });
      const body = await after.json();
      expect(body.packet.generationStatus).toBe("failed");
      expect(body.packet.generationError).toContain("interrupted");
    } finally {
      hangForever = false;
    }

    await db.delete(jobs).where(eq(jobs.id, job!.id));
    await deleteTestUser(email);
  });
});
