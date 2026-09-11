import { env } from "@/config";

// text-embedding-3-small — 1536 dimensions, matches EMBEDDING_DIMENSIONS
// in src/db/schema/jobs.ts. Changing models means changing that constant
// and re-embedding everything (dimensions aren't compatible across models).
const MODEL = "text-embedding-3-small";
const BATCH_SIZE = 100;

export class EmbeddingsNotConfiguredError extends Error {
  constructor() {
    super("OPENAI_API_KEY is not configured");
  }
}

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

/** Batches internally (OpenAI's endpoint accepts up to ~2048 inputs per
 * call, but we chunk conservatively). Order of the returned array matches
 * the order of `texts` regardless of what order the API responds in. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!env.OPENAI_API_KEY) throw new EmbeddingsNotConfiguredError();

  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, input: batch }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI embeddings request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    results.push(...sorted.map((d) => d.embedding));
  }

  return results;
}

export async function embedText(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text]);
  if (!embedding) throw new Error("OpenAI returned no embedding");
  return embedding;
}
