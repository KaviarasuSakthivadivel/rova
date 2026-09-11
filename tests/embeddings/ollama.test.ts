import { afterEach, describe, expect, it, mock } from "bun:test";
import { embedText, embedTexts } from "@/embeddings/ollama";
import { EmbeddingsNotConfiguredError } from "@/embeddings/errors";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ollama embedTexts", () => {
  it("returns [] for empty input without calling the API", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;

    expect(await embedTexts([])).toEqual([]);
  });

  it("returns embeddings in order from a real Ollama-shaped response", async () => {
    globalThis.fetch = mock(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBeTruthy();
      return Response.json({
        model: body.model,
        embeddings: (body.input as string[]).map((_t, i) => Array(768).fill(i / 10)),
      });
    }) as unknown as typeof fetch;

    const result = await embedTexts(["a", "b"]);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(768);
    expect(result[1]?.[0]).toBeCloseTo(0.1, 5);
  });

  it("throws EmbeddingsNotConfiguredError when the server can't be reached", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(embedTexts(["x"])).rejects.toBeInstanceOf(EmbeddingsNotConfiguredError);
  });

  it("throws EmbeddingsNotConfiguredError when the model isn't pulled (404)", async () => {
    globalThis.fetch = mock(async () => new Response("model not found", { status: 404 })) as unknown as typeof fetch;

    await expect(embedTexts(["x"])).rejects.toBeInstanceOf(EmbeddingsNotConfiguredError);
  });

  it("throws a plain error on other failures", async () => {
    globalThis.fetch = mock(async () => new Response("server error", { status: 500 })) as unknown as typeof fetch;

    await expect(embedTexts(["x"])).rejects.toThrow(/500/);
  });
});

describe("ollama embedText", () => {
  it("returns a single embedding", async () => {
    globalThis.fetch = mock(async () => Response.json({ embeddings: [Array(768).fill(0.5)] })) as unknown as typeof fetch;

    const result = await embedText("hello");
    expect(result).toHaveLength(768);
  });
});
