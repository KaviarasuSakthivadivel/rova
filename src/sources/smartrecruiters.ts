import { fetchWithRetry } from "@/lib/retry";
import type { JobSource, NormalizedJob } from "./base";

/**
 * SmartRecruiters public Posting API — public, unauthenticated.
 * https://developers.smartrecruiters.com/docs/endpoints
 */
export class SmartRecruitersSource implements JobSource {
  readonly source = "smartrecruiters";
  private static readonly BASE_URL = "https://api.smartrecruiters.com/v1/companies";
  private static readonly PAGE_SIZE = 100;

  constructor(
    private readonly companyIdentifier: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async fetchJobs(): Promise<NormalizedJob[]> {
    const postings: SmartRecruitersPosting[] = [];
    let offset = 0;
    let totalFound = Infinity;

    while (offset < totalFound) {
      const url = `${SmartRecruitersSource.BASE_URL}/${encodeURIComponent(this.companyIdentifier)}/postings?limit=${SmartRecruitersSource.PAGE_SIZE}&offset=${offset}`;
      const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) {
        throw new Error(`SmartRecruiters fetch failed (${response.status}) for company "${this.companyIdentifier}"`);
      }

      const data = (await response.json()) as SmartRecruitersListResponse;
      const batch = data.content ?? [];
      totalFound = data.totalFound ?? offset + batch.length;
      postings.push(...batch);

      if (batch.length === 0 || batch.length < SmartRecruitersSource.PAGE_SIZE) break;
      offset += batch.length;
    }

    // The list endpoint intentionally contains metadata but not the job-ad
    // body. Fetch details so summaries and ranking receive the actual posting
    // description rather than an empty string.
    const jobs: NormalizedJob[] = [];
    // Keep detail traffic bounded: large boards can contain hundreds of
    // postings and SmartRecruiters may rate-limit an unbounded Promise.all.
    for (let index = 0; index < postings.length; index += 10) {
      const batch = postings.slice(index, index + 10);
      jobs.push(...(await Promise.all(batch.map((posting) => this.fetchPosting(posting)))));
    }
    return jobs;
  }

  private async fetchPosting(posting: SmartRecruitersPosting): Promise<NormalizedJob> {
    const url = `${SmartRecruitersSource.BASE_URL}/${encodeURIComponent(this.companyIdentifier)}/postings/${encodeURIComponent(posting.id)}`;
    const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) {
      throw new Error(`SmartRecruiters detail fetch failed (${response.status}) for posting "${posting.id}"`);
    }

    const detail = (await response.json()) as SmartRecruitersDetail;
    return normalize({ ...posting, ...detail }, this.companyIdentifier);
  }
}

interface SmartRecruitersListResponse {
  offset?: number;
  limit?: number;
  totalFound?: number;
  content?: SmartRecruitersPosting[];
}

interface SmartRecruitersPosting {
  id: string;
  name: string;
  releasedDate?: string;
  location?: SmartRecruitersLocation;
  department?: SmartRecruitersLabel;
  function?: SmartRecruitersLabel;
  typeOfEmployment?: SmartRecruitersLabel;
  experienceLevel?: SmartRecruitersLabel;
  postingUrl?: string;
  applyUrl?: string;
}

interface SmartRecruitersDetail extends SmartRecruitersPosting {
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string }>;
  };
}

interface SmartRecruitersLocation {
  city?: string;
  region?: string;
  country?: string;
  fullLocation?: string;
  remote?: boolean;
  hybrid?: boolean;
}

interface SmartRecruitersLabel {
  id?: string;
  label?: string;
}

function normalize(raw: SmartRecruitersPosting & SmartRecruitersDetail, companyIdentifier: string): NormalizedJob {
  const location = raw.location;
  const sections = Object.values(raw.jobAd?.sections ?? {});
  const description = sections
    .map((section) => section.text)
    .filter((text): text is string => Boolean(text))
    .join("\n\n");

  let workplaceType: string | undefined;
  if (location?.remote) workplaceType = "remote";
  else if (location?.hybrid) workplaceType = "hybrid";

  return {
    externalId: raw.id,
    title: raw.name,
    description,
    location: location?.fullLocation ?? formatLocation(location),
    workplaceType,
    department: raw.department?.label,
    team: raw.function?.label,
    employmentType: raw.typeOfEmployment?.label,
    seniority: raw.experienceLevel?.label,
    jobUrl: raw.postingUrl ?? `https://jobs.smartrecruiters.com/${encodeURIComponent(companyIdentifier)}/${raw.id}`,
    applyUrl: raw.applyUrl,
    postedAt: parseDate(raw.releasedDate),
  };
}

function formatLocation(location: SmartRecruitersLocation | undefined): string | undefined {
  if (!location) return undefined;
  return [location.city, location.region, location.country].filter(Boolean).join(", ") || undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
