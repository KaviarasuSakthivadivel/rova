import type {
  ApplicationPacket,
  ApplicationPacketDetail,
  ApplicationPacketSummary,
  ApplicationStage,
  CodexStatus,
  Company,
  CrawlRun,
  DiscoveryCandidate,
  DiscoveryRunResult,
  Job,
  JobAction,
  JobResult,
  PacketAnswer,
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

  searchJobs: (params: {
    q?: string;
    location?: string;
    semantic?: boolean;
    postedWithinDays?: number;
    companyIds?: string[];
    seniority?: string[];
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.location) query.set("location", params.location);
    if (params.semantic) query.set("semantic", "true");
    if (params.postedWithinDays) query.set("postedWithinDays", String(params.postedWithinDays));
    if (params.companyIds && params.companyIds.length > 0) query.set("companyIds", params.companyIds.join(","));
    if (params.seniority && params.seniority.length > 0) query.set("seniority", params.seniority.join(","));
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    return request<{ jobs: JobResult[]; limit: number; offset: number; hasMore: boolean; mode: "keyword" | "similarity" | "ranked" }>(
      `/jobs?${query.toString()}`,
    );
  },

  getJob: (id: string) => request<JobResult>(`/jobs/${id}`),

  // Live location suggestions for the location filter's typeahead —
  // real distinct strings from the data, scoped to whatever else is
  // currently filtered (see GET /api/jobs/locations).
  getLocationSuggestions: (params: {
    search?: string;
    q?: string;
    semantic?: boolean;
    postedWithinDays?: number;
    companyIds?: string[];
    seniority?: string[];
  }) => {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.q) query.set("q", params.q);
    if (params.semantic) query.set("semantic", "true");
    if (params.postedWithinDays) query.set("postedWithinDays", String(params.postedWithinDays));
    if (params.companyIds && params.companyIds.length > 0) query.set("companyIds", params.companyIds.join(","));
    if (params.seniority && params.seniority.length > 0) query.set("seniority", params.seniority.join(","));
    return request<{ locations: { location: string; count: number }[] }>(`/jobs/locations?${query.toString()}`);
  },

  // Live counts for the filter sidebar, scoped to the same base search
  // (q/location/postedWithinDays/semantic) as searchJobs — NOT a static
  // per-company total, which goes stale the moment the search changes.
  getJobFacets: (params: { q?: string; location?: string; semantic?: boolean; postedWithinDays?: number }) => {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.location) query.set("location", params.location);
    if (params.semantic) query.set("semantic", "true");
    if (params.postedWithinDays) query.set("postedWithinDays", String(params.postedWithinDays));
    return request<{
      companies: { id: string; name: string; domain: string | null; count: number }[];
      seniority: Record<string, number>;
    }>(`/jobs/facets?${query.toString()}`);
  },

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

  getCompanies: () => request<{ companies: Company[] }>("/admin/companies"),

  deactivateCompany: (id: string) => request<{ company: Company }>(`/admin/companies/${id}/deactivate`, { method: "POST" }),

  reactivateCompany: (id: string) => request<{ company: Company }>(`/admin/companies/${id}/reactivate`, { method: "POST" }),

  getCrawlRuns: (limit = 50) => request<{ runs: CrawlRun[] }>(`/admin/crawl-runs?limit=${limit}`),

  triggerCrawl: () => request<{ ok: true; started: true }>("/admin/crawl", { method: "POST" }),

  getNewJobsCount: () => request<{ count: number; since: string | null }>("/jobs/new-count"),

  markJobsSeen: () => request<{ ok: true }>("/jobs/mark-seen", { method: "POST" }),

  addToPipeline: (jobId: string) => request<{ packet: ApplicationPacket }>(`/applications/${jobId}`, { method: "POST" }),

  removeFromPipeline: (jobId: string) => request<{ ok: true }>(`/applications/${jobId}`, { method: "DELETE" }),

  listPackets: () => request<{ packets: ApplicationPacketSummary[] }>("/applications"),

  getPacket: (jobId: string) => request<ApplicationPacketDetail>(`/applications/${jobId}`),

  generatePacket: (jobId: string, force = false) =>
    request<{ ok: true; started: true } | { packet: ApplicationPacket; cached: true }>(`/applications/${jobId}/generate`, {
      method: "POST",
      body: JSON.stringify({ force }),
    }),

  updatePacket: (jobId: string, data: { tailoredResumeText?: string; coverLetterText?: string; answers?: PacketAnswer[] }) =>
    request<{ packet: ApplicationPacket }>(`/applications/${jobId}`, { method: "PATCH", body: JSON.stringify(data) }),

  setPacketStage: (jobId: string, stage: ApplicationStage) =>
    request<{ packet: ApplicationPacket }>(`/applications/${jobId}/stage`, { method: "POST", body: JSON.stringify({ stage }) }),

  draftFreeformAnswer: (jobId: string, question: string) =>
    request<{ answers: PacketAnswer[] }>(`/applications/${jobId}/questions/answer`, {
      method: "POST",
      body: JSON.stringify({ question }),
    }),

  getCodexStatus: () => request<CodexStatus>("/providers/codex/status"),

  connectCodex: () => request<{ authorizeUrl: string }>("/providers/codex/connect", { method: "POST" }),

  disconnectCodex: () => request<{ ok: true }>("/providers/codex/disconnect", { method: "POST" }),
};

export { ApiError };
export type { Job, JobResult, Profile, User };
