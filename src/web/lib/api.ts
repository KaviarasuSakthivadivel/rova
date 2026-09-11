import type {
  CrawlRun,
  DiscoveryCandidate,
  DiscoveryRunResult,
  Job,
  JobAction,
  JobResult,
  Preferences,
  Profile,
  User,
} from "./types";

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(body.error ?? `Request failed with status ${res.status}`, res.status);
  }

  return res.json() as Promise<T>;
}

export const api = {
  signup: (email: string, password: string) =>
    request<{ user: User }>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    request<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: User | null }>("/auth/me"),

  getProfile: () => request<{ profile: Profile | null }>("/profile"),

  saveProfile: (data: { profileText: string; resumeText?: string; preferences?: Preferences }) =>
    request<{ profile: Profile }>("/profile", { method: "PUT", body: JSON.stringify(data) }),

  // Not routed through request() — a File body needs multipart/form-data
  // with a browser-generated boundary, which means NOT setting
  // Content-Type manually (request() always sets it to application/json).
  uploadResume: async (file: File): Promise<{ resumeText: string }> => {
    const form = new FormData();
    form.append("file", file);

    const res = await fetch("/api/profile/resume", { method: "POST", credentials: "include", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new ApiError(body.error ?? `Request failed with status ${res.status}`, res.status);
    }
    return res.json() as Promise<{ resumeText: string }>;
  },

  searchJobs: (params: { q?: string; location?: string; semantic?: boolean; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.location) query.set("location", params.location);
    if (params.semantic) query.set("semantic", "true");
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    return request<{ jobs: JobResult[]; limit: number; offset: number; mode: "keyword" | "similarity" | "ranked" }>(
      `/jobs?${query.toString()}`,
    );
  },

  getJob: (id: string) => request<JobResult>(`/jobs/${id}`),

  actOnJob: (id: string, action: JobAction) =>
    request<{ ok: true; action: JobAction }>(`/jobs/${id}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),

  discoverCompanies: (names: string[]) =>
    request<{ results: DiscoveryRunResult[] }>("/admin/discover", {
      method: "POST",
      body: JSON.stringify({ companies: names.map((name) => ({ name })) }),
    }),

  getDiscoveryCandidates: () =>
    request<{ candidates: DiscoveryCandidate[] }>("/admin/discovery-candidates"),

  approveDiscoveryCandidate: (id: string) =>
    request<{ ok: true }>(`/admin/discovery-candidates/${id}/approve`, { method: "POST" }),

  rejectDiscoveryCandidate: (id: string) =>
    request<{ ok: true }>(`/admin/discovery-candidates/${id}/reject`, { method: "POST" }),

  getCrawlRuns: (limit = 50) => request<{ runs: CrawlRun[] }>(`/admin/crawl-runs?limit=${limit}`),

  triggerCrawl: () => request<{ ok: true; started: true }>("/admin/crawl", { method: "POST" }),
};

export { ApiError };
export type { Job, JobResult, Profile, User };
