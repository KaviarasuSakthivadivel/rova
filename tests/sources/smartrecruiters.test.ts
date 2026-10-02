import { afterEach, describe, expect, it, mock } from "bun:test";
import { SmartRecruitersSource } from "@/sources/smartrecruiters";
import fixture from "../fixtures/smartrecruiters/postings.json";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("SmartRecruitersSource", () => {
  it("fetches posting details and normalizes the job", async () => {
    globalThis.fetch = mock(async (input) => {
      const url = String(input);
      return url.includes("/postings/744000153046229")
        ? Response.json({
            ...fixture.content[0],
            jobAd: {
              sections: {
                companyDescription: { title: "Company Description", text: "<p>Company</p>" },
                jobDescription: { title: "Job Description", text: "<p>Build things.</p>" },
              },
            },
          })
        : Response.json(fixture);
    }) as unknown as typeof fetch;

    const jobs = await new SmartRecruitersSource("LinkedIn3").fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(jobs[0]?.externalId).toBe("744000153046229");
    expect(jobs[0]?.title).toBe("Staff Software Engineer");
    expect(jobs[0]?.description).toContain("Build things.");
    expect(jobs[0]?.location).toBe("Mountain View, CA, United States");
    expect(jobs[0]?.workplaceType).toBe("hybrid");
    expect(jobs[0]?.department).toBe("Engineering");
    expect(jobs[0]?.employmentType).toBe("Full-time");
    expect(jobs[0]?.jobUrl).toContain("jobs.smartrecruiters.com/LinkedIn3");
    expect(jobs[0]?.postedAt).toBeInstanceOf(Date);
  });

  it("paginates list results before fetching details", async () => {
    let listCalls = 0;
    let detailCalls = 0;
    globalThis.fetch = mock(async (input) => {
      const url = String(input);
      if (url.includes("/postings/") && !url.endsWith("/postings?limit=100&offset=0")) {
        detailCalls += 1;
        const id = url.split("/postings/")[1];
        return Response.json({ ...fixture.content[0], id, name: `Job ${id}` });
      }

      listCalls += 1;
      if (listCalls === 1) {
        return Response.json({
          offset: 0,
          limit: 100,
          totalFound: 101,
          content: Array.from({ length: 100 }, (_, i) => ({ ...fixture.content[0], id: `job-${i}` })),
        });
      }
      return Response.json({ offset: 100, limit: 100, totalFound: 101, content: [{ ...fixture.content[0], id: "job-last" }] });
    }) as unknown as typeof fetch;

    const jobs = await new SmartRecruitersSource("example").fetchJobs();

    expect(jobs).toHaveLength(101);
    expect(listCalls).toBe(2);
    expect(detailCalls).toBe(101);
  });
});
