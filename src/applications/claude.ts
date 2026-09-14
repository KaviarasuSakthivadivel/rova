import Anthropic from "@anthropic-ai/sdk";
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
  isResumeAndCoverLetter,
  RESUME_JSON_SCHEMA,
  RESUME_SYSTEM_PROMPT,
  type ResumeAndCoverLetter,
  resumeUserPrompt,
} from "./prompt";

// Not cached as a module singleton — same reasoning as src/ranking/claude.ts
// and src/discovery/llm.ts: the SDK resolves `fetch` once at construction
// time, so a cached client would keep using whatever `fetch` was global on
// first use, breaking per-test mocking.
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new PacketGenerationNotConfiguredError("ANTHROPIC_API_KEY is not configured");
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

export async function generateResumeAndCoverLetter(input: GenerateResumeInput): Promise<GenerateResumeResult> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4096,
    // Generative prose, not classification — worth more effort than
    // rankJob's "low" scoring-tier call.
    output_config: { effort: "medium", format: { type: "json_schema", schema: RESUME_JSON_SCHEMA } },
    system: RESUME_SYSTEM_PROMPT,
    messages: [{ role: "user", content: resumeUserPrompt(input) }],
  });

  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };

  let result: ResumeAndCoverLetter | null = null;
  let error: string | undefined;

  if (response.stop_reason === "refusal") {
    console.warn("[applications] Claude declined to generate a resume/cover letter (refusal)");
    error = "refusal";
  } else {
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      console.warn("[applications] no text block in Claude's resume/cover-letter response");
      error = "no text block in response";
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(textBlock.text);
      } catch {
        console.warn("[applications] resume/cover-letter response wasn't valid JSON");
        error = "response wasn't valid JSON";
      }
      if (!error && !isResumeAndCoverLetter(parsed)) {
        console.warn("[applications] resume/cover-letter response didn't match the expected shape");
        error = "response didn't match the expected shape";
      } else if (!error) {
        result = parsed as ResumeAndCoverLetter;
      }
    }
  }

  logGeneration({
    name: "generate-resume",
    provider: "claude",
    model: env.ANTHROPIC_MODEL,
    input: { jobTitle: input.jobTitle, companyName: input.companyName },
    output: result,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    error,
  });

  return { result, ...usage };
}

/** Also used for the freeform "paste one question, get a draft answer"
 * helper — call it with a single-element questions array. */
export async function generateAnswers(input: GenerateAnswersInput): Promise<GenerateAnswersResult> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4096,
    output_config: { effort: "medium", format: { type: "json_schema", schema: ANSWERS_JSON_SCHEMA } },
    system: ANSWERS_SYSTEM_PROMPT,
    messages: [{ role: "user", content: answersUserPrompt(input) }],
  });

  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };

  let result: { answer: string }[] | null = null;
  let error: string | undefined;

  if (response.stop_reason === "refusal") {
    console.warn("[applications] Claude declined to draft answers (refusal)");
    error = "refusal";
  } else {
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      console.warn("[applications] no text block in Claude's answers response");
      error = "no text block in response";
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(textBlock.text);
      } catch {
        console.warn("[applications] answers response wasn't valid JSON");
        error = "response wasn't valid JSON";
      }
      if (!error && !isAnswersShape(parsed)) {
        console.warn("[applications] answers response didn't match the expected shape");
        error = "response didn't match the expected shape";
      } else if (!error) {
        result = (parsed as { answers: { answer: string }[] }).answers;
      }
    }
  }

  logGeneration({
    name: "generate-answers",
    provider: "claude",
    model: env.ANTHROPIC_MODEL,
    input: { jobTitle: input.jobTitle, companyName: input.companyName, questions: input.questions.map((q) => q.label) },
    output: result,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    error,
  });

  return { result, ...usage };
}
