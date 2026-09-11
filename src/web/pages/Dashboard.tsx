import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { JobCard } from "@/web/components/JobCard";
import { ApiError, api } from "@/web/lib/api";

const MODE_LABEL: Record<string, string> = {
  keyword: "Keyword search",
  similarity: "Semantic similarity",
  ranked: "AI-ranked to your profile",
};

export function Dashboard() {
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [submitted, setSubmitted] = useState({ q: "", location: "", semantic: false });

  const searchKey = ["jobs", submitted.q, submitted.location, submitted.semantic];
  const jobsQuery = useQuery({
    queryKey: searchKey,
    queryFn: () =>
      api.searchJobs({
        q: submitted.q || undefined,
        location: submitted.location || undefined,
        semantic: submitted.semantic,
        limit: 50,
      }),
  });

  const semanticError =
    jobsQuery.isError && jobsQuery.error instanceof ApiError && jobsQuery.error.status === 400
      ? jobsQuery.error.message
      : null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-fg">Jobs</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted({ q, location, semantic });
        }}
        className="mt-4 flex flex-wrap items-end gap-2.5"
      >
        <div className="min-w-[200px] flex-1">
          <input
            type="text"
            placeholder="Keyword — backend, Kafka, staff…"
            value={q}
            disabled={semantic}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
          />
        </div>
        <input
          type="text"
          placeholder="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="w-40 rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <label className="flex h-[34px] items-center gap-1.5 text-sm text-fg-muted">
          <input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          Match to my profile
        </label>
        <button type="submit" className="h-[34px] rounded-md bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover">
          Search
        </button>
      </form>

      {jobsQuery.data && (
        <p className="mt-4 text-xs text-fg-subtle">
          {MODE_LABEL[jobsQuery.data.mode] ?? jobsQuery.data.mode} · {jobsQuery.data.jobs.length} shown
        </p>
      )}

      <div className="mt-2.5 space-y-2">
        {jobsQuery.isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
        {semanticError && <p className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger">{semanticError}</p>}
        {jobsQuery.isError && !semanticError && (
          <p className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger">Failed to load jobs.</p>
        )}
        {jobsQuery.data && jobsQuery.data.jobs.length === 0 && (
          <p className="text-sm text-fg-muted">No jobs match yet — try a broader search.</p>
        )}
        {jobsQuery.data?.jobs.map((result) => <JobCard key={result.job.id} result={result} searchKey={searchKey} />)}
      </div>
    </div>
  );
}
