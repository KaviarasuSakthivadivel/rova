/**
 * The shape every ATS adapter normalizes into — ingestion never branches
 * on provider after this point. Ported from the Python dataclass sketched
 * in job_indexer_whole_chat.md.
 */
export interface NormalizedJob {
  externalId: string;

  title: string;
  description: string;

  location?: string;
  workplaceType?: string;

  department?: string;
  team?: string;
  employmentType?: string;
  seniority?: string;

  salaryCurrency?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryInterval?: string;

  jobUrl: string;
  applyUrl?: string;

  postedAt?: Date;
  sourceUpdatedAt?: Date;
}

export interface JobSource {
  readonly source: string;
  fetchJobs(): Promise<NormalizedJob[]>;
}
