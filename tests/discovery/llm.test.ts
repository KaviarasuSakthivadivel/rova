import { afterEach, describe, expect, it, mock } from "bun:test";
import { env } from "@/config";
import { discoverViaLlm, DiscoveryNotConfiguredError } from "@/discovery/llm";

const originalFetch = globalThis.fetch;
const originalKey = env.ANTHROPIC_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.ANTHROPIC_API_KEY = originalKey;
});

function mockAnthropicResponse(content: unknown[], stopReason = "end_turn") {
  globalThis.fetch = mock(async () =>
    Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: env.ANTHROPIC_MODEL,
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 40 },
    }),
  ) as unknown as typeof fetch;
}

describe("discoverViaLlm", () => {
  it("throws DiscoveryNotConfiguredError when no API key is set", async () => {
    env.ANTHROPIC_API_KEY = undefined;
    await expect(discoverViaLlm("Acme Inc")).rejects.toBeInstanceOf(DiscoveryNotConfiguredError);
  });

  it("parses a well-formed JSON answer from the final text block", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse([
      { type: "text", text: "I searched and found this:\n" },
      {
        type: "text",
        text: JSON.stringify({
          careersUrl: "https://boards.greenhouse.io/acme",
          ats: "greenhouse",
          atsIdentifier: "acme",
          confidence: 0.85,
          notes: "Found via web search",
        }),
      },
    ]);

    const result = await discoverViaLlm("Acme Inc");
    expect(result).toEqual({
      careersUrl: "https://boards.greenhouse.io/acme",
      ats: "greenhouse",
      atsIdentifier: "acme",
      confidence: 0.85,
      notes: "Found via web search",
    });
  });

  it("extracts JSON even when wrapped in prose/fences", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse([
      {
        type: "text",
        text:
          "Here's what I found:\n```json\n" +
          JSON.stringify({
            careersUrl: null,
            ats: "unknown",
            atsIdentifier: null,
            confidence: 0.1,
            notes: "Could not confirm",
          }) +
          "\n```",
      },
    ]);

    const result = await discoverViaLlm("Obscure Co");
    expect(result?.ats).toBe("unknown");
  });

  it("returns null on a model refusal", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse([{ type: "text", text: "" }], "refusal");

    const result = await discoverViaLlm("Acme Inc");
    expect(result).toBeNull();
  });

  it("returns null when the response isn't valid JSON", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse([{ type: "text", text: "I don't know." }]);

    const result = await discoverViaLlm("Acme Inc");
    expect(result).toBeNull();
  });

  it("returns null when the JSON doesn't match the expected shape", async () => {
    env.ANTHROPIC_API_KEY = "test-key";
    mockAnthropicResponse([{ type: "text", text: JSON.stringify({ unexpected: true }) }]);

    const result = await discoverViaLlm("Acme Inc");
    expect(result).toBeNull();
  });
});
