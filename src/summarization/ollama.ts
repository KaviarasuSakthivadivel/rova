import { env } from "@/config";
import { logGeneration } from "@/observability/langfuse";
import { SummarizationNotConfiguredError } from "./errors";
import { SUMMARIZE_SYSTEM_PROMPT, type SummarizeJobInput, summarizeUserPrompt } from "./prompt";

interface OllamaChatResponse {
  message: { content: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Local summarization via Ollama's /api/chat — no API key, no per-job
 * cost. Verified live against a real Ollama server + llama3.2:3b. */
export async function summarizeJob(input: SummarizeJobInput): Promise<string> {
  const url = `${env.OLLAMA_BASE_URL}/api/chat`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_CHAT_MODEL,
        stream: false,
        messages: [
          { role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
          { role: "user", content: summarizeUserPrompt(input) },
        ],
      }),
    });
  } catch (error) {
    throw new SummarizationNotConfiguredError(
      `couldn't reach Ollama at ${url} (${error instanceof Error ? error.message : String(error)}) — is \`ollama serve\` running?`,
    );
  }

  if (response.status === 404) {
    throw new SummarizationNotConfiguredError(
      `Ollama model "${env.OLLAMA_CHAT_MODEL}" isn't pulled — run \`ollama pull ${env.OLLAMA_CHAT_MODEL}\``,
    );
  }
  if (!response.ok) {
    throw new Error(`Ollama chat request failed (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as OllamaChatResponse;
  const summary = data.message.content.trim();

  logGeneration({
    name: "summarize-job",
    provider: "ollama",
    model: env.OLLAMA_CHAT_MODEL,
    input: { title: input.title, companyName: input.companyName },
    output: summary,
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
    error: summary ? undefined : "empty response",
  });

  return summary;
}
