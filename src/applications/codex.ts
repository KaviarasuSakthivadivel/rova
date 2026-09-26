import { randomUUID } from "node:crypto";
import { env } from "@/config";
import { logGeneration } from "@/observability/langfuse";
import { backendHeaders, CODEX_BASE_URL, forceRefresh, getValidAccessToken, PLAN_LIMIT_ERROR } from "./codexAuth";
import { PacketGenerationNotConfiguredError } from "./errors";
import {
  ANSWERS_JSON_SCHEMA,
  ANSWERS_SYSTEM_PROMPT,
  answersUserPrompt,
  type GenerateAnswersInput,
  type GenerateAnswersResult,
  type GenerateResumeInput,
  type GenerateResumeResult,
  isAnswersShape,
  isResumeAndCoverLetter,
  RESUME_JSON_SCHEMA,
  RESUME_SYSTEM_PROMPT,
  type ResumeAndCoverLetter,
  resumeUserPrompt,
} from "./prompt";

/**
 * Packet generation against the user's own ChatGPT Plus/Pro subscription
 * (src/applications/codexAuth.ts handles sign-in/token refresh) instead of a
 * metered API key. Raw fetch + manual SSE parsing — mirrors this project's
 * established convention for anything non-Anthropic (src/embeddings/openai.ts)
 * rather than pulling in the `openai` SDK.
 *
 * The backend is OpenAI's Responses API reached through the ChatGPT app's own
 * gateway (reverse-engineered, confirmed working by metaharn's own reference
 * implementation): streaming-only, rejects max_output_tokens/temperature/top_p,
 * requires `instructions`, honors `reasoning.effort`. Whether it actually
 * honors `text.format.type:"json_schema"` structured output is untested
 * against this specific passthrough — attempted first, with the same
 * defensive JSON.parse + shape-guard path claude.ts uses as the real safety
 * net regardless of whether strict enforcement is honored server-side.
 */

interface StreamResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

function isUnsupportedTextFormatError(message: string): boolean {
  return /unsupported (?:parameter|value)s?:?\s*'?text/i.test(message);
}

function buildRequestBody(userPrompt: string, systemPrompt: string, schema: object | undefined, schemaName: string) {
  const body: Record<string, unknown> = {
    model: env.CHATGPT_MODEL,
    input: [{ role: "user", content: userPrompt }],
    instructions: systemPrompt,
    store: false,
    stream: true,
    reasoning: { effort: "medium" },
  };
  if (schema) {
    body.text = { format: { type: "json_schema", name: schemaName, schema, strict: true } };
  }
  return body;
}

async function postResponses(accessToken: string, accountId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${CODEX_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...backendHeaders(accountId, randomUUID()),
    },
    body: JSON.stringify(body),
  });
}

async function consumeSseStream(response: Response): Promise<StreamResult | { error: string }> {
  if (!response.body) return { error: "no response body" };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const textParts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let sawCompletion = false;
  let failureMessage: string | undefined;

  const handleFrame = (frame: string) => {
    const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) return;
    const payload = dataLine.slice(5).trim();
    if (!payload || payload === "[DONE]") return;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }

    const type = event.type as string | undefined;
    if (type === "response.output_text.delta") {
      if (typeof event.delta === "string") textParts.push(event.delta);
    } else if (type === "response.completed") {
      sawCompletion = true;
      const usage = (event.response as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined)?.usage;
      inputTokens = usage?.input_tokens ?? 0;
      outputTokens = usage?.output_tokens ?? 0;
    } else if (type === "response.failed" || type === "response.incomplete") {
      sawCompletion = true;
      failureMessage = type;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      handleFrame(buffer.slice(0, sepIndex));
      buffer = buffer.slice(sepIndex + 2);
    }
  }
  if (buffer.trim()) handleFrame(buffer);

  if (!sawCompletion) return { error: "stream ended without a completion event" };
  if (failureMessage) return { error: failureMessage };
  if (textParts.length === 0) return { error: "no text in the response stream" };

  return { text: textParts.join(""), inputTokens, outputTokens };
}

/** One call to the Responses API, with the 401-refresh-retry-once and
 * 429-plan-limit handling this backend requires, plus one retry without
 * structured-output formatting if the backend rejects that parameter. */
async function callResponsesApi(userId: string, systemPrompt: string, userPrompt: string, schema: object, schemaName: string): Promise<StreamResult | null> {
  const token = await getValidAccessToken(userId);
  if (!token) throw new PacketGenerationNotConfiguredError("not connected to ChatGPT — connect it from your profile");

  let accessToken = token.accessToken;
  let accountId = token.accountId;
  let body = buildRequestBody(userPrompt, systemPrompt, schema, schemaName);
  let response = await postResponses(accessToken, accountId, body);

  if (response.status === 401) {
    const refreshed = await forceRefresh(userId);
    if (!refreshed) throw new PacketGenerationNotConfiguredError("ChatGPT session expired — reconnect it from your profile");
    accessToken = refreshed.accessToken;
    accountId = refreshed.accountId;
    response = await postResponses(accessToken, accountId, body);
  }

  if (response.status === 400) {
    const errorText = await response.clone().text();
    if (isUnsupportedTextFormatError(errorText)) {
      console.warn("[applications:codex] backend rejected structured output formatting — retrying without it");
      body = buildRequestBody(userPrompt, systemPrompt, undefined, schemaName);
      response = await postResponses(accessToken, accountId, body);
    }
  }

  if (response.status === 429) {
    console.warn(`[applications:codex] ${PLAN_LIMIT_ERROR}`);
    await response.body?.cancel().catch(() => {});
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.warn(`[applications:codex] Responses API returned HTTP ${response.status}: ${errorText.slice(0, 300)}`);
    return null;
  }

  const result = await consumeSseStream(response);
  if ("error" in result) {
    console.warn(`[applications:codex] ${result.error}`);
    return null;
  }
  return result;
}

export async function generateResumeAndCoverLetter(input: GenerateResumeInput): Promise<GenerateResumeResult> {
  let result: ResumeAndCoverLetter | null = null;
  let error: string | undefined;
  let usage = { inputTokens: 0, outputTokens: 0 };

  const stream = await callResponsesApi(input.userId, RESUME_SYSTEM_PROMPT, resumeUserPrompt(input), RESUME_JSON_SCHEMA, "resume_and_cover_letter");
  if (!stream) {
    error = "no usable response from ChatGPT";
  } else {
    usage = stream;
    let parsed: unknown;
    try {
      parsed = JSON.parse(stream.text);
    } catch {
      console.warn("[applications:codex] resume/cover-letter response wasn't valid JSON");
      error = "response wasn't valid JSON";
    }
    if (!error && !isResumeAndCoverLetter(parsed)) {
      console.warn("[applications:codex] resume/cover-letter response didn't match the expected shape");
      error = "response didn't match the expected shape";
    } else if (!error) {
      result = parsed as ResumeAndCoverLetter;
    }
  }

  logGeneration({
    name: "generate-resume",
    provider: "codex",
    model: env.CHATGPT_MODEL,
    input: { jobTitle: input.jobTitle, companyName: input.companyName },
    output: result,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    error,
  });

  return { result, ...usage };
}

/** Also used for the freeform "paste one question, get a draft answer" helper. */
export async function generateAnswers(input: GenerateAnswersInput): Promise<GenerateAnswersResult> {
  let result: { answer: string }[] | null = null;
  let error: string | undefined;
  let usage = { inputTokens: 0, outputTokens: 0 };

  const stream = await callResponsesApi(input.userId, ANSWERS_SYSTEM_PROMPT, answersUserPrompt(input), ANSWERS_JSON_SCHEMA, "answers");
  if (!stream) {
    error = "no usable response from ChatGPT";
  } else {
    usage = stream;
    let parsed: unknown;
    try {
      parsed = JSON.parse(stream.text);
    } catch {
      console.warn("[applications:codex] answers response wasn't valid JSON");
      error = "response wasn't valid JSON";
    }
    if (!error && !isAnswersShape(parsed)) {
      console.warn("[applications:codex] answers response didn't match the expected shape");
      error = "response didn't match the expected shape";
    } else if (!error) {
      result = (parsed as { answers: { answer: string }[] }).answers;
    }
  }

  logGeneration({
    name: "generate-answers",
    provider: "codex",
    model: env.CHATGPT_MODEL,
    input: { jobTitle: input.jobTitle, companyName: input.companyName, questions: input.questions.map((q) => q.label) },
    output: result,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    error,
  });

  return { result, ...usage };
}
