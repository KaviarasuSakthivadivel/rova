import type { JobSource, NormalizedJob } from "./base";

/**
 * Ashby Job Postings API — public.
 * https://developers.ashbyhq.com/docs/public-job-posting-api
 */
export class AshbySource implements JobSource {
  readonly source = "ashby";
  private static readonly BASE_URL = "https://api.ashbyhq.com/posting-api/job-board";

  constructor(
    private readonly jobBoardName: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async fetchJobs(): Promise<NormalizedJob[]> {
    const url = `${AshbySource.BASE_URL}/${this.jobBoardName}?includeCompensation=true`;

    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) {
      throw new Error(`Ashby fetch failed (${response.status}) for job board "${this.jobBoardName}"`);
    }

    const data = (await response.json()) as { jobs?: AshbyJob[] };
    return (data.jobs ?? []).filter((job) => job.isListed !== false).map(normalize);
  }
}

interface AshbyJob {
  title: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  location?: string;
  department?: string;
  team?: string;
  jobUrl?: string;
  applyUrl?: string;
  isListed?: boolean;
  compensation?: Record<string, unknown>;
}

function normalize(raw: AshbyJob): NormalizedJob {
  // Ashby's payload has no single stable numeric ID field in the public
  // feed — jobUrl is the most stable identifier available. Revisit once
  // real payloads are inspected (see job_indexer_whole_chat.md §10 note).
  const externalId = raw.jobUrl ?? raw.title;

  return {
    externalId,
    title: raw.title,
    description: raw.descriptionHtml ?? raw.descriptionPlain ?? "",
    location: raw.location,
    department: raw.department,
    team: raw.team,
    jobUrl: raw.jobUrl ?? "",
    applyUrl: raw.applyUrl,
  };
}
