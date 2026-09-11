import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { JobCard } from "@/web/components/JobCard";
import { ApiError, api } from "@/web/lib/api";

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
      <h1 className="text-2xl font-semibold text-slate-900">Jobs</h1>
      <p className="mt-1 text-sm text-slate-500">
        {submitted.semantic
          ? "Ranked by similarity to your profile."
          : "Deterministic keyword search across every job tracked from company career pages."}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted({ q, location, semantic });
        }}
        className="mt-6 flex flex-wrap items-center gap-3"
      >
        <input
          type="text"
          placeholder="Title or keyword (e.g. backend, Kafka)"
          value={q}
          disabled={semantic}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-[240px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
        />
        <input
          type="text"
          placeholder="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="w-48 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={semantic}
            onChange={(e) => setSemantic(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Match to my profile
        </label>
        <button
          type="submit"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Search
        </button>
      </form>

      <div className="mt-6 space-y-3">
        {jobsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {semanticError && <p className="text-sm text-red-600">{semanticError}</p>}
        {jobsQuery.isError && !semanticError && <p className="text-sm text-red-600">Failed to load jobs.</p>}
        {jobsQuery.data && jobsQuery.data.jobs.length === 0 && (
          <p className="text-sm text-slate-500">No jobs match yet — try a broader search.</p>
        )}
        {jobsQuery.data?.jobs.map((result) => <JobCard key={result.job.id} result={result} searchKey={searchKey} />)}
      </div>
    </div>
  );
}
