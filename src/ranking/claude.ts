import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config";

export class RankingNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured");
  }
}

export interface JobScore {
  score: number;
  strongMatches: string[];
  missingRequirements: string[];
  reasons: string[];
}

export interface RankJobInput {
  profileText: string;
  jobTitle: string;
  companyName: string;
  location: string | null;
  description: string | null;
}

export interface RankJobResult {
  score: JobScore | null; // null on a model refusal — caller skips this job, doesn't crash the run
  inputTokens: number;
  outputTokens: number;
}

// Hand-written (not derived from a Zod schema) — @anthropic-ai/sdk's
// zodOutputFormat() helper requires Zod v4 internals, and this project is
// on Zod v3 for @hono/zod-validator compatibility. The result is validated
// locally after parsing instead (see rankJob below).
const SCORE_JSON_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    strongMatches: { type: "array", items: { type: "string" } },
    missingRequirements: { type: "array", items: { type: "string" } },
    reasons: {
      type: "array",
      items: { type: "string" },
      description: "Short bullet points explaining the score — shown to the user as \"why you're seeing this\".",
    },
  },
  required: ["score", "strongMatches", "missingRequirements", "reasons"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You score how well one job posting matches one candidate's profile.
Be specific and grounded in the actual text — cite real skills/requirements from the job,
not generic encouragement. A low score is a valid, expected outcome for a bad match.`;

// Not cached as a module singleton: the SDK resolves `fetch` once at
// construction time (Shims.getDefaultFetch() captures the current global
// `fetch` directly, not a live binding), so a cached client would keep
// using whatever `fetch` was global the first time this ran — including
// in tests that mock `globalThis.fetch` per-test. Construction itself is
// cheap relative to the network call this client is about to make.
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new RankingNotConfiguredError();
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

function isJobScore(value: unknown): value is JobScore {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.score === "number" &&
    Array.isArray(v.strongMatches) &&
    Array.isArray(v.missingRequirements) &&
    Array.isArray(v.reasons)
  );
}

export async function rankJob(input: RankJobInput): Promise<RankJobResult> {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 2048,
    // Scoring/classification is exactly the workload shape the effort
    // guidance calls out as not needing high effort — keeps per-job cost
    // and latency down across a shortlist run.
    output_config: { effort: "low", format: { type: "json_schema", schema: SCORE_JSON_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Candidate profile:\n${input.profileText}\n\nJob posting:\nTitle: ${input.jobTitle}\nCompany: ${input.companyName}\nLocation: ${input.location ?? "unspecified"}\nDescription: ${input.description ?? "(no description)"}`,
      },
    ],
  });

  const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };

  if (response.stop_reason === "refusal") {
    console.warn("[ranking] Claude declined to score a job (refusal) — skipping it");
    return { score: null, ...usage };
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    console.warn("[ranking] no text block in Claude's response — skipping this job");
    return { score: null, ...usage };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    console.warn("[ranking] Claude's response wasn't valid JSON — skipping this job");
    return { score: null, ...usage };
  }

  if (!isJobScore(parsed)) {
    console.warn("[ranking] Claude's response didn't match the expected shape — skipping this job");
    return { score: null, ...usage };
  }

  return { score: parsed, ...usage };
}

// $/1M tokens, first-party API rates — see PRD.md / claude-api skill pricing
// table. Used only for the per-run cost log (PRD.md §10 cost guardrail),
// not billing — update alongside ANTHROPIC_MODEL if you change models.
const PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function estimateCostUsd(inputTokens: number, outputTokens: number): number | null {
  const pricing = PRICING_PER_MILLION[env.ANTHROPIC_MODEL];
  if (!pricing) return null;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
