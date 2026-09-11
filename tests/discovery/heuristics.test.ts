import { afterEach, describe, expect, it, mock } from "bun:test";
import { discoverViaHeuristics } from "@/discovery/heuristics";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("discoverViaHeuristics", () => {
  it("reports a match only for URLs that actually resolve", async () => {
    // Verification hits the real API endpoints the crawler adapters use
    // (boards-api.greenhouse.io), not the human-facing hosted pages —
    // those 200/301 even for nonexistent slugs on Ashby/Greenhouse (see
    // src/discovery/heuristics.ts for the live-verified evidence).
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = url.toString();
      if (href.includes("boards-api.greenhouse.io/v1/boards/acmeinc/jobs")) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    const matches = await discoverViaHeuristics("Acme Inc");

    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.ats === "greenhouse")).toBe(true);
    expect(matches.some((m) => m.atsIdentifier === "acmeinc")).toBe(true);
    expect(matches[0]?.careersUrl).toContain("boards.greenhouse.io"); // stored URL is still the human-facing page
    expect(matches[0]?.careersUrl).not.toContain("boards-api");
  });

  it("returns no matches when nothing resolves", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;

    const matches = await discoverViaHeuristics("Totally Unknown Company Xyz");
    expect(matches).toEqual([]);
  });

  it("treats a fetch error (network failure) as a non-match rather than throwing", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const matches = await discoverViaHeuristics("Some Company");
    expect(matches).toEqual([]);
  });

  it("tries hyphenated and non-hyphenated slug variants", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      requestedUrls.push(url.toString());
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    await discoverViaHeuristics("Multi Word Co");

    expect(requestedUrls.some((u) => u.includes("multiwordco"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("multi-word-co"))).toBe(true);
  });
});
