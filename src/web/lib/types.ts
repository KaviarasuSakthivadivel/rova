export type UserRole = "user" | "admin";

export interface User {
  id: string;
  email: string;
  role: UserRole;
}

export interface Preferences {
  locations?: string[];
  remoteOk?: boolean;
  seniority?: string[];
  compFloor?: number;
}

export interface Profile {
  id: string;
  userId: string;
  profileText: string;
  resumeText: string | null;
  preferences: Preferences;
  embedding: number[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  companyId: string;
  source: string;
  title: string;
  description: string | null;
  location: string | null;
  workplaceType: string | null;
  department: string | null;
  team: string | null;
  employmentType: string | null;
  jobUrl: string;
  applyUrl: string | null;
  status: string;
  firstSeenAt: string;
  /** One-sentence, non-marketing summary — null until the summarization
   * stage has processed this job. */
  summary: string | null;
}

export type JobAction = "saved" | "dismissed" | "applied";

export interface JobResult {
  job: Job;
  companyName: string;
  action: JobAction | null;
  /** Raw cosine similarity (0-1) — the "similarity" search mode only.
   * Fast, but poorly calibrated as a quality signal on its own; prefer
   * `score`/`reasons` (the "ranked" mode) when available. */
  similarity?: number;
  /** LLM-scored fit (0-100) with grounded reasons — the "ranked" mode. */
  score?: number;
  reasons?: string[];
}

export interface DiscoveryCandidate {
  id: string;
  name: string;
  domain: string | null;
  guessedAts: string | null;
  guessedIdentifier: string | null;
  confidence: string | null;
  status: string;
  createdAt: string;
}

export interface DiscoveryRunResult {
  companyName: string;
  matched: boolean;
  source: "heuristic" | "llm" | "none";
  reason?: string;
}

export interface CrawlRun {
  id: string;
  companyName: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  jobsSeen: number | null;
  jobsAdded: number | null;
  jobsUpdated: number | null;
  jobsClosed: number | null;
  errorMessage: string | null;
}
