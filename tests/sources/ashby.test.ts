import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { AshbySource } from "@/sources/ashby";
import fixture from "../fixtures/ashby/jobs.json";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock(async () => Response.json(fixture)) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("AshbySource", () => {
  it("filters out unlisted jobs and normalizes the rest", async () => {
    const source = new AshbySource("example");
    const jobs = await source.fetchJobs();

    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job?.title).toBe("Infrastructure Engineer");
    expect(job?.externalId).toBe("https://jobs.ashbyhq.com/example/infra-engineer");
    expect(job?.location).toBe("London, UK");
  });
});
