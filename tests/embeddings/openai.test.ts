import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { env } from "@/config";
import { embedText, embedTexts, EmbeddingsNotConfiguredError } from "@/embeddings/openai";

const originalFetch = globalThis.fetch;
const originalKey = env.OPENAI_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  env.OPENAI_API_KEY = originalKey;
});

describe("embedTexts", () => {
  it("throws EmbeddingsNotConfiguredError when no API key is set", async () => {
    env.OPENAI_API_KEY = undefined;
    await expect(embedTexts(["hello"])).rejects.toBeInstanceOf(EmbeddingsNotConfiguredError);
  });

  it("returns [] for empty input without calling the API", async () => {
    env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = mock(async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;

    expect(await embedTexts([])).toEqual([]);
  });

  it("preserves input order regardless of the API's response order", async () => {
    env.OPENAI_API_KEY = "test-key";

    globalThis.fetch = mock(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.model).toBe("text-embedding-3-small");

      // Respond out of order to prove embedTexts re-sorts by `index`.
      const data = (body.input as string[]).map((_text: string, i: number) => ({
        embedding: [i, i, i],
        index: i,
      }));
      return Response.json({ data: [...data].reverse() });
    }) as unknown as typeof fetch;

    const result = await embedTexts(["a", "b", "c"]);
    expect(result).toEqual([
      [0, 0, 0],
      [1, 1, 1],
      [2, 2, 2],
    ]);
  });

  it("throws with the response body on a non-OK response", async () => {
    env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = mock(async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;

    await expect(embedTexts(["x"])).rejects.toThrow(/429/);
  });
});

describe("embedText", () => {
  it("returns a single embedding", async () => {
    env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = mock(async () => Response.json({ data: [{ embedding: [1, 2, 3], index: 0 }] })) as unknown as typeof fetch;

    expect(await embedText("hello")).toEqual([1, 2, 3]);
  });
});
