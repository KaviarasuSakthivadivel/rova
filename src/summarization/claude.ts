import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config";
import { logGeneration } from "@/observability/langfuse";
import { SummarizationNotConfiguredError } from "./errors";
import { SUMMARIZE_SYSTEM_PROMPT, type SummarizeJobInput, summarizeUserPrompt } from "./prompt";

// Not cached as a module singleton — see src/ranking/claude.ts for why
// (the SDK resolves `fetch` once at construction time).
function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new SummarizationNotConfiguredError("ANTHROPIC_API_KEY is not configured");
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

export async function summarizeJob(input: SummarizeJobInput): Promise<string> {
  const client = getClient();

  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 100,
    output_config: { effort: "low" },
    system: SUMMARIZE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: summarizeUserPrompt(input) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const summary = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

  logGeneration({
    name: "summarize-job",
    provider: "claude",
    model: env.ANTHROPIC_MODEL,
    input: { title: input.title, companyName: input.companyName },
    output: summary,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    error: summary ? undefined : "no text block in response",
  });

  return summary;
}
