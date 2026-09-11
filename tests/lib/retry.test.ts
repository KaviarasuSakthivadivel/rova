import { describe, expect, it } from "bun:test";
import { fetchWithRetry, HttpStatusError, withRetry } from "@/lib/retry";

describe("withRetry", () => {
  it("returns the result on first success without retrying", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient");
        return "ok";
      },
      { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 5 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after maxAttempts and throws the last error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error(`fail ${calls}`);
        },
        { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
      ),
    ).rejects.toThrow("fail 3");
    expect(calls).toBe(3);
  });

  it("stops immediately when shouldRetry returns false", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("non-retryable");
        },
        { maxAttempts: 5, baseDelayMs: 1, shouldRetry: () => false },
      ),
    ).rejects.toThrow("non-retryable");
    expect(calls).toBe(1);
  });
});

describe("fetchWithRetry", () => {
  it("retries a 503 and succeeds on the next attempt", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) return new Response("unavailable", { status: 503 });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const res = await fetchWithRetry("https://example.test", undefined, { baseDelayMs: 1, maxDelayMs: 5 });
      expect(res.status).toBe(200);
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not retry a 404 — returns it directly", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const res = await fetchWithRetry("https://example.test", undefined, { baseDelayMs: 1, maxDelayMs: 5 });
      expect(res.status).toBe(404);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("gives up after maxAttempts on persistent 500s", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("error", { status: 500 });
    }) as unknown as typeof fetch;

    try {
      await expect(
        fetchWithRetry("https://example.test", undefined, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 }),
      ).rejects.toBeInstanceOf(HttpStatusError);
      expect(calls).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
