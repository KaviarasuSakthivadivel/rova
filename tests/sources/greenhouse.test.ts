import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { fetchGreenhouseQuestions, GreenhouseSource } from "@/sources/greenhouse";
import fixture from "../fixtures/greenhouse/jobs.json";
import questionsFixture from "../fixtures/greenhouse/questions.json";

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

describe("fetchGreenhouseQuestions", () => {
  it("keeps real custom questions, drops standard identity fields and non-text field types", async () => {
    globalThis.fetch = mock(async () => Response.json(questionsFixture)) as unknown as typeof fetch;

    const questions = await fetchGreenhouseQuestions("example", "4461450008");

    expect(questions).toHaveLength(2);
    expect(questions.map((q) => q.label)).toEqual([
      "LinkedIn Profile",
      "Are you currently located in SF/NYC or open to relocating?",
    ]);
    expect(questions[0]?.required).toBe(false);
    expect(questions[1]?.required).toBe(true);
    expect(questions[0]?.description).toContain("LinkedIn profile or Resume");
  });

  it("throws on a non-ok response", async () => {
    globalThis.fetch = mock(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    await expect(fetchGreenhouseQuestions("example", "does-not-exist")).rejects.toThrow();
  });
});
