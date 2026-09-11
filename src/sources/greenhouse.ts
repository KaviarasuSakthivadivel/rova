import { fetchWithRetry } from "@/lib/retry";
import type { JobSource, NormalizedJob } from "./base";

/**
 * Greenhouse Job Board API — public, unauthenticated GET.
 * https://developer.greenhouse.io/job-board.html
 */
export class GreenhouseSource implements JobSource {
  readonly source = "greenhouse";
  private static readonly BASE_URL = "https://boards-api.greenhouse.io/v1/boards";

  constructor(
    private readonly boardToken: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async fetchJobs(): Promise<NormalizedJob[]> {
    const url = `${GreenhouseSource.BASE_URL}/${this.boardToken}/jobs?content=true`;

    const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) {
      throw new Error(`Greenhouse fetch failed (${response.status}) for board "${this.boardToken}"`);
    }

    const data = (await response.json()) as { jobs?: unknown[] };
    return (data.jobs ?? []).map((raw) => normalize(raw as GreenhouseJob));
  }
}

interface GreenhouseJob {
  id: number | string;
  title: string;
  content?: string;
  absolute_url?: string;
  first_published?: string;
  updated_at?: string;
  location?: { name?: string };
  offices?: { location?: string }[];
}

function normalize(raw: GreenhouseJob): NormalizedJob {
  const location = raw.location?.name ?? raw.offices?.[0]?.location;

  return {
    externalId: String(raw.id),
    title: raw.title,
    description: raw.content ?? "",
    location,
    jobUrl: raw.absolute_url ?? "",
    postedAt: parseDate(raw.first_published),
    sourceUpdatedAt: parseDate(raw.updated_at),
  };
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
