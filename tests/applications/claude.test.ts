import { afterEach, describe, expect, it, mock } from "bun:test";
import { generateAnswers, generateResumeAndCoverLetter } from "@/applications/claude";
import { PacketGenerationNotConfiguredError } from "@/applications/errors";
import { env } from "@/config";

const originalFetch = globalThis.fetch;
const originalKey = env.ANTHROPIC_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.ANTHROPIC_API_KEY = originalKey;
});

function mockAnthropicResponse(body: unknown, opts?: { stopReason?: string; status?: number }) {
  globalThis.fetch = mock(async () =>
    Response.json(
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: env.ANTHROPIC_MODEL,
        content: typeof body === "string" ? [{ type: "text", text: body }] : body,
        stop_reason: opts?.stopReason ?? "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 40 },
      },
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
};

describe("generateResumeAndCoverLetter", () => {
  it("throws PacketGenerationNotConfiguredError when no API key is set", async () => {
    env.ANTHROPIC_API_KEY = undefined;
    await expect(generateResumeAndCoverLetter(resumeInput)).rejects.toBeInstanceOf(PacketGenerationNotConfiguredError);
  });

  it("parses a well-formed structured response", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse(JSON.stringify({ tailoredResumeText: "SENIOR BACKEND ENGINEER\n- Kafka", coverLetterText: "Dear hiring team..." }));

    const result = await generateResumeAndCoverLetter(resumeInput);
    expect(result.result).toEqual({ tailoredResumeText: "SENIOR BACKEND ENGINEER\n- Kafka", coverLetterText: "Dear hiring team..." });
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(40);
  });

  it("returns result: null (not a throw) on a model refusal", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse([{ type: "text", text: "" }], { stopReason: "refusal" });

    const result = await generateResumeAndCoverLetter(resumeInput);
    expect(result.result).toBeNull();
  });

  it("returns result: null when the response isn't valid JSON", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse("not json at all");

    const result = await generateResumeAndCoverLetter(resumeInput);
    expect(result.result).toBeNull();
  });

  it("returns result: null when the JSON doesn't match the expected shape", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse(JSON.stringify({ unexpected: true }));

    const result = await generateResumeAndCoverLetter(resumeInput);
    expect(result.result).toBeNull();
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
};

describe("generateAnswers", () => {
  it("throws PacketGenerationNotConfiguredError when no API key is set", async () => {
    env.ANTHROPIC_API_KEY = undefined;
    await expect(generateAnswers(answersInput)).rejects.toBeInstanceOf(PacketGenerationNotConfiguredError);
  });

  it("parses answers in the same order as the input questions", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse(JSON.stringify({ answers: [{ answer: "Based in NYC, open to relocating." }, { answer: "I use Claude for code review." }] }));

    const result = await generateAnswers(answersInput);
    expect(result.result).toEqual([{ answer: "Based in NYC, open to relocating." }, { answer: "I use Claude for code review." }]);
  });

  it("works with a single ad-hoc question (the freeform-helper shape)", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse(JSON.stringify({ answers: [{ answer: "Grounded draft answer." }] }));

    const result = await generateAnswers({ ...answersInput, questions: [{ label: "Why us?", description: null, required: false }] });
    expect(result.result).toEqual([{ answer: "Grounded draft answer." }]);
  });

  it("returns result: null on a model refusal", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse([{ type: "text", text: "" }], { stopReason: "refusal" });

    const result = await generateAnswers(answersInput);
    expect(result.result).toBeNull();
  });

  it("returns result: null when the JSON doesn't match the expected shape", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse(JSON.stringify({ unexpected: true }));

    const result = await generateAnswers(answersInput);
    expect(result.result).toBeNull();
  });
});
