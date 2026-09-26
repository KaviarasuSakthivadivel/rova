import { afterEach, describe, expect, it, mock } from "bun:test";
import { generateAnswers, generateResumeAndCoverLetter } from "@/applications/ollama";
import { PacketGenerationNotConfiguredError } from "@/applications/errors";
import { env } from "@/config";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockOllamaResponse(content: unknown, opts?: { status?: number }) {
  globalThis.fetch = mock(async () =>
    Response.json(
      { message: { content: typeof content === "string" ? content : JSON.stringify(content) }, prompt_eval_count: 120, eval_count: 45 },
      { status: opts?.status ?? 200 },
    ),
  ) as unknown as typeof fetch;
}

const resumeInput = {
  profileText: "Backend engineer. Java, Kafka, AWS.",
  resumeText: "Senior Engineer at Acme, 2019-2024.",
  jobTitle: "Senior Backend Engineer",
  companyName: "Acme",
  location: "Remote",
  description: "Own our Kafka-based data platform.",
  userId: "test-user",
};

// Long enough to clear isImplausiblyShort's floors — a "well-formed
// response" fixture that's just a few words would now itself trip the
// too-short retry path and mask what each test actually means to check.
const PLAUSIBLE_RESUME_TEXT =
  "Jane Doe\nRemote | jane@example.com\n\nEXPERIENCE\n\nAcme · Remote · 2019 – 2024\nSenior Backend Engineer\n- Owned the Kafka-based data platform end to end.\n- Reduced p99 query latency by 40% through targeted caching and index tuning.";
const PLAUSIBLE_COVER_LETTER_TEXT =
  "Dear hiring team,\n\nI've spent five years building backend systems on Kafka and AWS, and I'd love to bring that experience to Acme's data platform team.\n\nSincerely,\nJane";

describe("generateResumeAndCoverLetter (ollama)", () => {
  it("throws PacketGenerationNotConfiguredError when the server is unreachable", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    await expect(generateResumeAndCoverLetter(resumeInput)).rejects.toBeInstanceOf(PacketGenerationNotConfiguredError);
  });

  it("throws PacketGenerationNotConfiguredError when the model isn't pulled (404)", async () => {
    globalThis.fetch = mock(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;

    await expect(generateResumeAndCoverLetter(resumeInput)).rejects.toBeInstanceOf(PacketGenerationNotConfiguredError);
  });

  it("parses a well-formed structured response and maps token counts", async () => {
    mockOllamaResponse({ tailoredResumeText: PLAUSIBLE_RESUME_TEXT, coverLetterText: PLAUSIBLE_COVER_LETTER_TEXT });

    const result = await generateResumeAndCoverLetter(resumeInput);
    expect(result.result).toEqual({ tailoredResumeText: PLAUSIBLE_RESUME_TEXT, coverLetterText: PLAUSIBLE_COVER_LETTER_TEXT });
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(45);
  });

  it("returns result: null after exhausting retries when every response is invalid JSON", async () => {
    mockOllamaResponse("not json at all");

    const result = await generateResumeAndCoverLetter(resumeInput);
    expect(result.result).toBeNull();
    expect((globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.length).toBe(3); // MAX_ATTEMPTS
  });

  it("retries a truncated response and succeeds on a later attempt", async () => {
    // Regression test: Ollama occasionally returns an incomplete response
    // under load (content cut off mid-string) even though the HTTP call
    // itself succeeds — reproduced live against a real Ollama server.
    let call = 0;
    globalThis.fetch = mock(async () => {
      call += 1;
      if (call < 3) {
        return Response.json({ message: { content: '{"tailoredResumeText": "cut off mid str' }, prompt_eval_count: 100, eval_count: 30 });
      }
      return Response.json({
        message: { content: JSON.stringify({ tailoredResumeText: PLAUSIBLE_RESUME_TEXT, coverLetterText: PLAUSIBLE_COVER_LETTER_TEXT }) },
        done_reason: "stop",
        prompt_eval_count: 100,
        eval_count: 60,
      });
    }) as unknown as typeof fetch;

    const result = await generateResumeAndCoverLetter(resumeInput);
    expect(result.result).toEqual({ tailoredResumeText: PLAUSIBLE_RESUME_TEXT, coverLetterText: PLAUSIBLE_COVER_LETTER_TEXT });
    expect(call).toBe(3);
  });

  it("retries an implausibly short but well-formed response and succeeds on a later attempt", async () => {
    // Regression test: a real generation came back as valid JSON that got
    // cut off right after the candidate's name — well-formed, so the old
    // shape check alone accepted it as a "successful" resume containing
    // almost nothing. Treated as transient (like truncated JSON above),
    // not a hard shape mismatch, so it retries instead of failing outright.
    let call = 0;
    globalThis.fetch = mock(async () => {
      call += 1;
      if (call < 3) {
        return Response.json({
          message: { content: JSON.stringify({ tailoredResumeText: "Jane Doe", coverLetterText: "Dear team," }) },
          done_reason: "stop",
          prompt_eval_count: 100,
          eval_count: 8,
        });
      }
      return Response.json({
        message: { content: JSON.stringify({ tailoredResumeText: PLAUSIBLE_RESUME_TEXT, coverLetterText: PLAUSIBLE_COVER_LETTER_TEXT }) },
        done_reason: "stop",
        prompt_eval_count: 100,
        eval_count: 60,
      });
    }) as unknown as typeof fetch;

    const result = await generateResumeAndCoverLetter(resumeInput);
    expect(result.result).toEqual({ tailoredResumeText: PLAUSIBLE_RESUME_TEXT, coverLetterText: PLAUSIBLE_COVER_LETTER_TEXT });
    expect(call).toBe(3);
  });

  it("returns result: null after exhausting retries when every response is implausibly short", async () => {
    mockOllamaResponse({ tailoredResumeText: "Jane Doe", coverLetterText: "Dear team," });

    const result = await generateResumeAndCoverLetter(resumeInput);
    expect(result.result).toBeNull();
    expect((globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.length).toBe(3); // MAX_ATTEMPTS
  });

  it("does not retry on a well-formed but wrong-shape response", async () => {
    mockOllamaResponse({ unexpected: true });

    const result = await generateResumeAndCoverLetter(resumeInput);
    expect(result.result).toBeNull();
    expect((globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.length).toBe(1); // shape mismatch isn't transient — no point retrying
  });

  it("requests structured output with the shared JSON schema", async () => {
    mockOllamaResponse({ tailoredResumeText: PLAUSIBLE_RESUME_TEXT, coverLetterText: PLAUSIBLE_COVER_LETTER_TEXT });
    await generateResumeAndCoverLetter(resumeInput);

    const call = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls[0];
    if (!call) throw new Error("expected fetch to have been called");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.model).toBe(env.OLLAMA_CHAT_MODEL);
    expect(body.format.required).toEqual(["tailoredResumeText", "coverLetterText"]);
    expect(body.stream).toBe(false);
  });
});

const answersInput = {
  profileText: "Backend engineer based in NYC, open to relocating.",
  resumeText: null,
  jobTitle: "Senior Backend Engineer",
  companyName: "Acme",
  questions: [
    { label: "Are you located in SF/NYC or open to relocating?", description: null, required: true },
    { label: "What AI tools do you use today?", description: null, required: false },
  ],
  userId: "test-user",
};

describe("generateAnswers (ollama)", () => {
  it("throws PacketGenerationNotConfiguredError when the server is unreachable", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;

    await expect(generateAnswers(answersInput)).rejects.toBeInstanceOf(PacketGenerationNotConfiguredError);
  });

  it("parses answers in the same order as the input questions", async () => {
    mockOllamaResponse({ answers: [{ answer: "Based in NYC, open to relocating." }, { answer: "I use Claude for code review." }] });

    const result = await generateAnswers(answersInput);
    expect(result.result).toEqual([{ answer: "Based in NYC, open to relocating." }, { answer: "I use Claude for code review." }]);
  });

  it("works with a single ad-hoc question (the freeform-helper shape)", async () => {
    mockOllamaResponse({ answers: [{ answer: "Grounded draft answer." }] });

    const result = await generateAnswers({ ...answersInput, questions: [{ label: "Why us?", description: null, required: false }] });
    expect(result.result).toEqual([{ answer: "Grounded draft answer." }]);
  });

  it("returns result: null when the JSON doesn't match the expected shape", async () => {
    mockOllamaResponse({ unexpected: true });

    const result = await generateAnswers(answersInput);
    expect(result.result).toBeNull();
  });
});
