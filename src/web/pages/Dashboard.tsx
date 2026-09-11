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
      <h1 className="text-3xl font-normal text-on-surface">Jobs</h1>
      <p className="mt-1 text-sm text-on-surface-variant">Every open role tracked directly from company career pages.</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted({ q, location, semantic });
        }}
        className="mt-6 rounded-2xl border border-outline-variant bg-surface-container-low p-4"
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="text-xs font-medium text-on-surface-variant">Keyword</label>
            <input
              type="text"
              placeholder="backend, Kafka, staff…"
              value={q}
              disabled={semantic}
              onChange={(e) => setQ(e.target.value)}
              className="mt-1 w-full rounded-xl border border-outline bg-surface px-3.5 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            />
          </div>
          <div className="w-44">
            <label className="text-xs font-medium text-on-surface-variant">Location</label>
            <input
              type="text"
              placeholder="Remote, SF…"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="mt-1 w-full rounded-xl border border-outline bg-surface px-3.5 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <label className="flex h-[38px] items-center gap-2 text-sm font-medium text-on-surface-variant">
            <input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} className="h-4 w-4 accent-primary" />
            Match to my profile
          </label>
          <button
            type="submit"
            className="state-layer h-[38px] rounded-full bg-primary px-6 text-sm font-medium text-on-primary shadow-sm"
          >
            Search
          </button>
        </div>
      </form>

      <div className="mt-5 flex items-center justify-between">
        {jobsQuery.data && (
          <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant/70">
            {MODE_LABEL[jobsQuery.data.mode] ?? jobsQuery.data.mode} · {jobsQuery.data.jobs.length} shown
          </p>
        )}
      </div>

      <div className="mt-3 space-y-3">
        {jobsQuery.isLoading && <p className="text-sm text-on-surface-variant">Loading…</p>}
        {semanticError && (
          <p className="rounded-xl bg-error-container px-4 py-2.5 text-sm text-on-error-container">{semanticError}</p>
        )}
        {jobsQuery.isError && !semanticError && (
          <p className="rounded-xl bg-error-container px-4 py-2.5 text-sm text-on-error-container">Failed to load jobs.</p>
        )}
        {jobsQuery.data && jobsQuery.data.jobs.length === 0 && (
          <p className="text-sm text-on-surface-variant">No jobs match yet — try a broader search.</p>
        )}
        {jobsQuery.data?.jobs.map((result) => <JobCard key={result.job.id} result={result} searchKey={searchKey} />)}
      </div>
    </div>
  );
}
