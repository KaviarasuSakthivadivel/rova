import { afterEach, describe, expect, it, mock } from "bun:test";
import { env } from "@/config";
import { estimateCostUsd, rankJob, RankingNotConfiguredError } from "@/ranking/claude";

const originalFetch = globalThis.fetch;
const originalKey = env.ANTHROPIC_API_KEY;
const originalModel = env.ANTHROPIC_MODEL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.ANTHROPIC_API_KEY = originalKey;
  env.ANTHROPIC_MODEL = originalModel;
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

const input = {
  profileText: "Backend engineer. Java, Kafka, AWS.",
  jobTitle: "Senior Backend Engineer",
  companyName: "Acme",
  location: "Remote",
  description: "Own our Kafka-based data platform.",
};

describe("rankJob", () => {
  it("throws RankingNotConfiguredError when no API key is set", async () => {
    env.ANTHROPIC_API_KEY = undefined;
    await expect(rankJob(input)).rejects.toBeInstanceOf(RankingNotConfiguredError);
  });

  it("parses a well-formed structured response", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse(
      JSON.stringify({
        score: 88,
        strongMatches: ["Kafka", "distributed systems"],
        missingRequirements: ["Kubernetes"],
        reasons: ["Strong Kafka background matches the data platform focus."],
      }),
    );

    const result = await rankJob(input);
    expect(result.score).toEqual({
      score: 88,
      strongMatches: ["Kafka", "distributed systems"],
      missingRequirements: ["Kubernetes"],
      reasons: ["Strong Kafka background matches the data platform focus."],
    });
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(40);
  });

  it("returns score: null (not a throw) on a model refusal", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse([{ type: "text", text: "" }], { stopReason: "refusal" });

    const result = await rankJob(input);
    expect(result.score).toBeNull();
  });

  it("returns score: null when the response isn't valid JSON", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse("not json at all");

    const result = await rankJob(input);
    expect(result.score).toBeNull();
  });

  it("returns score: null when the JSON doesn't match the expected shape", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse(JSON.stringify({ unexpected: true }));

    const result = await rankJob(input);
    expect(result.score).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  it("computes cost from known model pricing", () => {
    env.ANTHROPIC_MODEL = "claude-sonnet-5";
    // 1000 input tokens @ $2/1M + 1000 output tokens @ $10/1M
    expect(estimateCostUsd(1000, 1000)).toBeCloseTo(0.002 + 0.01, 6);
  });

  it("returns null for an unrecognized model", () => {
    env.ANTHROPIC_MODEL = "some-future-model";
    expect(estimateCostUsd(1000, 1000)).toBeNull();
  });
});
