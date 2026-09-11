import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { LeverSource } from "@/sources/lever";
import fixture from "../fixtures/lever/postings.json";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("LeverSource", () => {
  it("normalizes a single page of postings", async () => {
    globalThis.fetch = mock(async () => Response.json(fixture)) as unknown as typeof fetch;

    const source = new LeverSource("example");
    const jobs = await source.fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [job] = jobs;
    expect(job?.externalId).toBe("abc-123-def");
    expect(job?.title).toBe("Staff Software Engineer, Data Platform");
    expect(job?.workplaceType).toBe("remote");
    expect(job?.department).toBe("Engineering");
    expect(job?.salaryMin).toBe(220000);
    expect(job?.salaryMax).toBe(300000);
    expect(job?.jobUrl).toBe("https://jobs.lever.co/example/abc-123-def");
  });

  it("paginates until a short page is returned", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      ...fixture[0],
      id: `job-${i}`,
    }));
    const shortPage = [{ ...fixture[0], id: "last-job" }];

    let call = 0;
    globalThis.fetch = mock(async () => {
      call += 1;
      return Response.json(call === 1 ? fullPage : shortPage);
    }) as unknown as typeof fetch;

    const source = new LeverSource("example");
    const jobs = await source.fetchJobs();

    expect(jobs).toHaveLength(101);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});
