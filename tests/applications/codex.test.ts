import { describe, expect, it, mock } from "bun:test";

// getValidAccessToken/forceRefresh would otherwise hit the real DB and the
// real OpenAI token endpoint — mock the auth module so this test exercises
// codex.ts's own logic (request building, SSE parsing, 401-refresh-retry,
// 429/malformed-response handling) in isolation. mock.module works
// retroactively even though codex.ts statically imports the real module, as
// long as codex.ts itself is pulled in via a dynamic `await import()` after
// this call — see tests/api/adminCrawl.test.ts for the same trick.
let getValidAccessTokenCalls = 0;
let forceRefreshCalls = 0;
let tokenBehavior: "valid" | "expired" = "valid";

mock.module("@/applications/codexAuth", () => ({
  getValidAccessToken: mock(async () => {
    getValidAccessTokenCalls += 1;
    if (tokenBehavior === "expired") return null;
    return { accessToken: "token-a", accountId: "acct_test" };
  }),
  forceRefresh: mock(async () => {
    forceRefreshCalls += 1;
    return { accessToken: "token-b", accountId: "acct_test" };
  }),
  backendHeaders: () => ({ "chatgpt-account-id": "acct_test", originator: "rova", "OpenAI-Beta": "responses=experimental", "session-id": "test-session" }),
  CODEX_BASE_URL: "https://chatgpt.com/backend-api/codex",
  PLAN_LIMIT_ERROR: "plan limit reached",
}));

const originalFetch = globalThis.fetch;

function sseBody(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

function sseResponse(events: unknown[], status = 200): Response {
  return new Response(sseBody(events), { status, headers: { "Content-Type": "text/event-stream" } });
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

describe("generateResumeAndCoverLetter (codex)", () => {
  it("parses a well-formed streamed response", async () => {
    getValidAccessTokenCalls = 0;
    tokenBehavior = "valid";
    const payload = { tailoredResumeText: "SENIOR BACKEND ENGINEER\n- Kafka", coverLetterText: "Dear hiring team..." };
    globalThis.fetch = mock(async () =>
      sseResponse([
        { type: "response.output_text.delta", delta: JSON.stringify(payload).slice(0, 20) },
        { type: "response.output_text.delta", delta: JSON.stringify(payload).slice(20) },
        { type: "response.completed", response: { usage: { input_tokens: 100, output_tokens: 40 } } },
      ]),
    ) as unknown as typeof fetch;

    const { generateResumeAndCoverLetter } = await import("@/applications/codex");
    const result = await generateResumeAndCoverLetter(resumeInput);

    expect(result.result).toEqual(payload);
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(40);
    expect(getValidAccessTokenCalls).toBe(1);
    globalThis.fetch = originalFetch;
  });

  it("refreshes once and retries on a 401, then succeeds", async () => {
    forceRefreshCalls = 0;
    let call = 0;
    const payload = { tailoredResumeText: "SENIOR ENGINEER", coverLetterText: "Dear team." };
    globalThis.fetch = mock(async () => {
      call += 1;
      if (call === 1) return new Response("unauthorized", { status: 401 });
      return sseResponse([
        { type: "response.output_text.delta", delta: JSON.stringify(payload) },
        { type: "response.completed", response: { usage: { input_tokens: 50, output_tokens: 20 } } },
      ]);
    }) as unknown as typeof fetch;

    const { generateResumeAndCoverLetter } = await import("@/applications/codex");
    const result = await generateResumeAndCoverLetter(resumeInput);

    expect(result.result).toEqual(payload);
    expect(forceRefreshCalls).toBe(1);
    expect(call).toBe(2);
    globalThis.fetch = originalFetch;
  });

  it("returns result: null (not a throw) when the plan's usage limit is hit", async () => {
    globalThis.fetch = mock(async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;

    const { generateResumeAndCoverLetter } = await import("@/applications/codex");
    const result = await generateResumeAndCoverLetter(resumeInput);

    expect(result.result).toBeNull();
    globalThis.fetch = originalFetch;
  });

  it("returns result: null when the streamed text isn't valid JSON", async () => {
    globalThis.fetch = mock(async () => sseResponse([{ type: "response.output_text.delta", delta: "not json at all" }, { type: "response.completed", response: { usage: {} } }])) as unknown as typeof fetch;

    const { generateResumeAndCoverLetter } = await import("@/applications/codex");
    const result = await generateResumeAndCoverLetter(resumeInput);

    expect(result.result).toBeNull();
    globalThis.fetch = originalFetch;
  });
});
