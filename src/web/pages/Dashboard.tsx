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
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-faint">01 — Browse</p>
      <h1 className="mt-1 font-display text-4xl font-medium text-ink">Jobs</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted({ q, location, semantic });
        }}
        className="mt-8 flex flex-wrap items-end gap-3 border-b-2 border-rule-strong pb-6"
      >
        <div className="min-w-[240px] flex-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Keyword</label>
          <input
            type="text"
            placeholder="backend, Kafka, staff…"
            value={q}
            disabled={semantic}
            onChange={(e) => setQ(e.target.value)}
            className="mt-1 w-full border-2 border-ink bg-paper px-3 py-2 text-ink placeholder:text-ink-faint focus:border-rust focus:outline-none disabled:border-rule disabled:bg-paper-dim disabled:text-ink-faint"
          />
        </div>
        <div className="w-48">
          <label className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Location</label>
          <input
            type="text"
            placeholder="Remote, SF…"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="mt-1 w-full border-2 border-ink bg-paper px-3 py-2 text-ink placeholder:text-ink-faint focus:border-rust focus:outline-none"
          />
        </div>
        <label className="flex h-[42px] items-center gap-2 text-sm font-medium text-ink-soft">
          <input
            type="checkbox"
            checked={semantic}
            onChange={(e) => setSemantic(e.target.checked)}
            className="h-4 w-4 accent-rust"
          />
          Match to my profile
        </label>
        <button
          type="submit"
          className="h-[42px] bg-ink px-6 text-sm font-semibold uppercase tracking-wide text-paper transition-colors hover:bg-rust"
        >
          Search
        </button>
      </form>

      <div className="mt-6 flex items-center justify-between">
        {jobsQuery.data && (
          <p className="font-mono text-xs uppercase tracking-wide text-ink-faint">
            {MODE_LABEL[jobsQuery.data.mode] ?? jobsQuery.data.mode} · {jobsQuery.data.jobs.length} shown
          </p>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {jobsQuery.isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
        {semanticError && <p className="border-l-2 border-rust bg-rust-tint px-3 py-2 text-sm text-rust-dim">{semanticError}</p>}
        {jobsQuery.isError && !semanticError && (
          <p className="border-l-2 border-rust bg-rust-tint px-3 py-2 text-sm text-rust-dim">Failed to load jobs.</p>
        )}
        {jobsQuery.data && jobsQuery.data.jobs.length === 0 && (
          <p className="text-sm text-ink-soft">No jobs match yet — try a broader search.</p>
        )}
        {jobsQuery.data?.jobs.map((result) => <JobCard key={result.job.id} result={result} searchKey={searchKey} />)}
      </div>
    </div>
  );
}
