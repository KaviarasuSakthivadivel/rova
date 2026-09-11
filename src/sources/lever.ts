import { fetchWithRetry } from "@/lib/retry";
import type { JobSource, NormalizedJob } from "./base";

/**
 * Lever Postings API — public, paginated via skip/limit.
 * https://github.com/lever/postings-api
 */
export class LeverSource implements JobSource {
  readonly source = "lever";
  private static readonly BASE_URL = "https://api.lever.co/v0/postings";
  private static readonly PAGE_SIZE = 100;

  constructor(
    private readonly site: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async fetchJobs(): Promise<NormalizedJob[]> {
    const jobs: NormalizedJob[] = [];
    let skip = 0;

    while (true) {
      const url = `${LeverSource.BASE_URL}/${this.site}?mode=json&skip=${skip}&limit=${LeverSource.PAGE_SIZE}`;
      const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) {
        throw new Error(`Lever fetch failed (${response.status}) for site "${this.site}"`);
      }

      const batch = (await response.json()) as LeverJob[];
      if (batch.length === 0) break;

      jobs.push(...batch.map(normalize));

      if (batch.length < LeverSource.PAGE_SIZE) break;
      skip += LeverSource.PAGE_SIZE;
    }

    return jobs;
  }
}

interface LeverJob {
  id: string;
  text: string;
  descriptionPlain?: string;
  hostedUrl?: string;
  applyUrl?: string;
  workplaceType?: string;
  categories?: {
    location?: string;
    department?: string;
    team?: string;
    commitment?: string;
  };
  salaryRange?: {
    currency?: string;
    min?: number;
    max?: number;
    interval?: string;
  };
}

function normalize(raw: LeverJob): NormalizedJob {
  const categories = raw.categories ?? {};
  const salary = raw.salaryRange ?? {};

  return {
    externalId: raw.id,
    title: raw.text,
    description: raw.descriptionPlain ?? "",
    location: categories.location,
    workplaceType: raw.workplaceType,
    department: categories.department,
    team: categories.team,
    employmentType: categories.commitment,
    salaryCurrency: salary.currency,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryInterval: salary.interval,
    jobUrl: raw.hostedUrl ?? "",
    applyUrl: raw.applyUrl,
  };
}
