import { env } from "@/config";
import { logGeneration } from "@/observability/langfuse";
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
  isImplausiblyShort,
  isResumeAndCoverLetter,
  RESUME_JSON_SCHEMA,
  RESUME_SYSTEM_PROMPT,
  resumeUserPrompt,
} from "./prompt";

interface OllamaChatResponse {
  message: { content: string };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

// Retries observed live: Ollama occasionally returns a truncated response
// under load (content cut off mid-string, done_reason missing/not "stop")
// even though the HTTP request itself succeeds — the structured-output
// grammar constrains *shape* token-by-token, but a dropped/interrupted
// generation still comes back as incomplete JSON. Distinct from a model
// that reliably produces the wrong shape, which retrying won't fix — so
// this only retries on a parse/truncation failure, not a shape mismatch.
const MAX_ATTEMPTS = 3;

/** Local packet generation via Ollama's /api/chat, using its structured-
 * outputs `format` field (a JSON Schema, enforced via constrained
 * decoding server-side — not dependent on the model reliably following
 * "respond with JSON" instructions on its own) with the exact same
 * schemas the Claude backend uses. No API key, no per-packet cost — but
 * worth noting quality depends heavily on OLLAMA_CHAT_MODEL; a small
 * model (e.g. the 3B default used for one-sentence job summaries) may
 * produce noticeably weaker tailored resumes/cover letters than Claude. */
async function chat(system: string, user: string, schema: object): Promise<{ content: string; done: boolean; inputTokens: number; outputTokens: number }> {
  const url = `${env.OLLAMA_BASE_URL}/api/chat`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_CHAT_MODEL,
        stream: false,
        format: schema,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (error) {
    throw new PacketGenerationNotConfiguredError(
      `couldn't reach Ollama at ${url} (${error instanceof Error ? error.message : String(error)}) — is \`ollama serve\` running?`,
    );
  }

  if (response.status === 404) {
    throw new PacketGenerationNotConfiguredError(
      `Ollama model "${env.OLLAMA_CHAT_MODEL}" isn't pulled — run \`ollama pull ${env.OLLAMA_CHAT_MODEL}\``,
    );
  }
  if (!response.ok) {
    throw new Error(`Ollama chat request failed (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as OllamaChatResponse;
  return {
    content: data.message.content,
    done: data.done_reason === "stop",
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
  };
}

function logResumeGeneration(input: GenerateResumeInput, result: unknown, usage: { inputTokens: number; outputTokens: number }, error?: string) {
  logGeneration({
    name: "generate-resume",
    provider: "ollama",
    model: env.OLLAMA_CHAT_MODEL,
    input: { jobTitle: input.jobTitle, companyName: input.companyName },
    output: result,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    error,
  });
}

export async function generateResumeAndCoverLetter(input: GenerateResumeInput): Promise<GenerateResumeResult> {
  let usage = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { content, done, inputTokens, outputTokens } = await chat(RESUME_SYSTEM_PROMPT, resumeUserPrompt(input), RESUME_JSON_SCHEMA);
    usage = { inputTokens, outputTokens };

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn(
        `[applications] Ollama's resume/cover-letter response wasn't valid JSON (attempt ${attempt}/${MAX_ATTEMPTS}${done ? "" : ", response looked truncated"})`,
      );
      if (attempt === MAX_ATTEMPTS) logResumeGeneration(input, null, usage, "response wasn't valid JSON after retries");
      continue;
    }

    if (!isResumeAndCoverLetter(parsed)) {
      console.warn("[applications] Ollama's resume/cover-letter response didn't match the expected shape");
      logResumeGeneration(input, null, usage, "response didn't match the expected shape");
      return { result: null, ...usage }; // a shape mismatch is a real model failure, not transient — don't retry
    }

    // Seen live: valid JSON that got cut short right after the name,
    // leaving a well-formed but essentially empty resume — the same
    // "generation got interrupted mid-stream" failure as the JSON-parse
    // case above, just past the point where parsing itself would catch
    // it. Retry rather than fail outright, but only up to the same cap.
    if (isImplausiblyShort(parsed)) {
      console.warn(`[applications] Ollama's resume/cover-letter response was implausibly short (attempt ${attempt}/${MAX_ATTEMPTS})`);
      if (attempt === MAX_ATTEMPTS) logResumeGeneration(input, parsed, usage, "response was implausibly short after retries");
      continue;
    }

    logResumeGeneration(input, parsed, usage);
    return { result: parsed, ...usage };
  }

  return { result: null, ...usage };
}

/** Also used for the freeform "paste one question, get a draft answer"
 * helper — call it with a single-element questions array. */
function logAnswersGeneration(input: GenerateAnswersInput, result: unknown, usage: { inputTokens: number; outputTokens: number }, error?: string) {
  logGeneration({
    name: "generate-answers",
    provider: "ollama",
    model: env.OLLAMA_CHAT_MODEL,
    input: { jobTitle: input.jobTitle, companyName: input.companyName, questions: input.questions.map((q) => q.label) },
    output: result,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    error,
  });
}

export async function generateAnswers(input: GenerateAnswersInput): Promise<GenerateAnswersResult> {
  let usage = { inputTokens: 0, outputTokens: 0 };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { content, done, inputTokens, outputTokens } = await chat(ANSWERS_SYSTEM_PROMPT, answersUserPrompt(input), ANSWERS_JSON_SCHEMA);
    usage = { inputTokens, outputTokens };

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn(`[applications] Ollama's answers response wasn't valid JSON (attempt ${attempt}/${MAX_ATTEMPTS}${done ? "" : ", response looked truncated"})`);
      if (attempt === MAX_ATTEMPTS) logAnswersGeneration(input, null, usage, "response wasn't valid JSON after retries");
      continue;
    }

    if (!isAnswersShape(parsed)) {
      console.warn("[applications] Ollama's answers response didn't match the expected shape");
      logAnswersGeneration(input, null, usage, "response didn't match the expected shape");
      return { result: null, ...usage };
    }

    logAnswersGeneration(input, parsed.answers, usage);
    return { result: parsed.answers, ...usage };
  }

  return { result: null, ...usage };
}
