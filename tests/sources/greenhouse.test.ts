import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { GreenhouseSource } from "@/sources/greenhouse";
import fixture from "../fixtures/greenhouse/jobs.json";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = mock(async () => Response.json(fixture)) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GreenhouseSource", () => {
  it("normalizes jobs without hitting a live API", async () => {
    const source = new GreenhouseSource("example");
    const jobs = await source.fetchJobs();

    expect(jobs).toHaveLength(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [first, second] = jobs;
    expect(first?.externalId).toBe("7654321");
    expect(first?.title).toBe("Senior Backend Engineer");
    expect(first?.location).toBe("Remote - US"); // location.name takes priority
    expect(first?.jobUrl).toBe("https://boards.greenhouse.io/example/jobs/7654321");
    expect(first?.postedAt).toBeInstanceOf(Date);

    // location.name absent (empty object) -> falls back to offices[0].location
    expect(second?.location).toBe("New York, NY");
    expect(second?.postedAt).toBeUndefined();
  });
});
