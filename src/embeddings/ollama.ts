import { env } from "@/config";
import { EmbeddingsNotConfiguredError } from "./errors";

interface OllamaEmbedResponse {
  embeddings: number[][];
}

/** Local embeddings via Ollama's native /api/embed — no API key, runs
 * fully offline. Verified live against a real Ollama server: POST
 * {model, input: string[]} -> {embeddings: number[][], ...}. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const url = `${env.OLLAMA_BASE_URL}/api/embed`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: env.OLLAMA_EMBEDDING_MODEL, input: texts }),
    });
  } catch (error) {
    throw new EmbeddingsNotConfiguredError(
      `couldn't reach Ollama at ${url} (${error instanceof Error ? error.message : String(error)}) — is \`ollama serve\` running?`,
    );
  }

  if (response.status === 404) {
    throw new EmbeddingsNotConfiguredError(
      `Ollama model "${env.OLLAMA_EMBEDDING_MODEL}" isn't pulled — run \`ollama pull ${env.OLLAMA_EMBEDDING_MODEL}\``,
    );
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embeddings request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as OllamaEmbedResponse;
  return data.embeddings;
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  if (!embedding) throw new Error("Ollama returned no embedding");
  return embedding;
}
