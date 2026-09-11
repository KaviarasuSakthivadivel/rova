export interface User {
  id: string;
  email: string;
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
}

export type JobAction = "saved" | "dismissed" | "applied";

export interface JobResult {
  job: Job;
  companyName: string;
  action: JobAction | null;
  similarity?: number;
}
