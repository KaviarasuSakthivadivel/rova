import { afterEach, describe, expect, it, mock } from "bun:test";
import { env } from "@/config";
import { embedTexts } from "@/embeddings";

const originalFetch = globalThis.fetch;
const originalProvider = env.EMBEDDINGS_PROVIDER;
const originalKey = env.OPENAI_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.EMBEDDINGS_PROVIDER = originalProvider;
  env.OPENAI_API_KEY = originalKey;
});

describe("embeddings dispatcher", () => {
  it("routes to OpenAI when EMBEDDINGS_PROVIDER=openai", async () => {
    env.EMBEDDINGS_PROVIDER = "openai";
    env.OPENAI_API_KEY = "test-key";

    let calledUrl: string | undefined;
    globalThis.fetch = mock(async (url: string) => {
      calledUrl = url.toString();
      return Response.json({ data: [{ embedding: Array(768).fill(0.1), index: 0 }] });
    }) as unknown as typeof fetch;

    await embedTexts(["hello"]);
    expect(calledUrl).toContain("api.openai.com");
  });

  it("routes to Ollama when EMBEDDINGS_PROVIDER=ollama", async () => {
    env.EMBEDDINGS_PROVIDER = "ollama";

    let calledUrl: string | undefined;
    globalThis.fetch = mock(async (url: string) => {
      calledUrl = url.toString();
      return Response.json({ embeddings: [Array(768).fill(0.1)] });
    }) as unknown as typeof fetch;

    await embedTexts(["hello"]);
    expect(calledUrl).toContain("11434");
  });
});
