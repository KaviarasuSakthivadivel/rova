import { afterEach, describe, expect, it, mock } from "bun:test";
import { fetchApplicationQuestions } from "@/applications/questions";
import questionsFixture from "../fixtures/greenhouse/questions.json";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchApplicationQuestions", () => {
  it("fetches and normalizes real questions for a Greenhouse company", async () => {
    globalThis.fetch = mock(async () => Response.json(questionsFixture)) as unknown as typeof fetch;

    const questions = await fetchApplicationQuestions({ ats: "greenhouse", atsIdentifier: "example" }, { externalId: "123" });

    expect(questions).toHaveLength(2);
    expect(questions[0]).toEqual({
      label: "LinkedIn Profile",
      description: "Please ensure to provide either your LinkedIn profile or Resume, we require at least one of the two.",
      required: false,
    });
  });

  it("returns [] for Lever without hitting the network", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;

    const questions = await fetchApplicationQuestions({ ats: "lever", atsIdentifier: "example" }, { externalId: "123" });
    expect(questions).toEqual([]);
  });

  it("returns [] for Ashby without hitting the network", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch;

    const questions = await fetchApplicationQuestions({ ats: "ashby", atsIdentifier: "example" }, { externalId: "123" });
    expect(questions).toEqual([]);
  });

  it("returns [] (not a throw) when the Greenhouse fetch fails", async () => {
    globalThis.fetch = mock(async () => new Response("error", { status: 500 })) as unknown as typeof fetch;

    const questions = await fetchApplicationQuestions({ ats: "greenhouse", atsIdentifier: "example" }, { externalId: "123" });
    expect(questions).toEqual([]);
  });
});
