import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { JobDetail } from "@/web/components/JobDetail";
import { JobListItem } from "@/web/components/JobListItem";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const results = jobsQuery.data?.jobs ?? [];
  const selected = results.find((r) => r.job.id === selectedId) ?? results[0] ?? null;

  useEffect(() => {
    setSelectedId(null);
  }, [submitted]);

  const semanticError =
    jobsQuery.isError && jobsQuery.error instanceof ApiError && jobsQuery.error.status === 400
      ? jobsQuery.error.message
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line bg-panel px-6 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({ q, location, semantic });
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <h1 className="mr-2 shrink-0 text-lg font-extrabold text-ink">Jobs</h1>
          <input
            type="text"
            placeholder="Search backend, Kafka, staff…"
            value={q}
            disabled={semantic}
            onChange={(e) => setQ(e.target.value)}
            className="min-w-[160px] flex-1 rounded-full bg-panel-soft px-4 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-40"
          />
          <input
            type="text"
            placeholder="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-32 rounded-full bg-panel-soft px-4 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} className="h-3.5 w-3.5 accent-brand" />
            Match to me
          </label>
          <button type="submit" className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-dark">
            Search
          </button>
        </form>
        {jobsQuery.data && (
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {MODE_LABEL[jobsQuery.data.mode] ?? jobsQuery.data.mode} · {results.length} results
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[340px] shrink-0 overflow-y-auto border-r border-line bg-panel sm:w-[380px]">
          {jobsQuery.isLoading && <p className="p-4 text-sm text-ink-muted">Loading…</p>}
          {semanticError && <p className="m-4 rounded-xl bg-red-soft px-3 py-2.5 text-sm text-red">{semanticError}</p>}
          {jobsQuery.isError && !semanticError && (
            <p className="m-4 rounded-xl bg-red-soft px-3 py-2.5 text-sm text-red">Failed to load jobs.</p>
          )}
          {jobsQuery.data && results.length === 0 && <p className="p-4 text-sm text-ink-muted">No jobs match yet.</p>}
          {results.map((result) => (
            <JobListItem
              key={result.job.id}
              result={result}
              selected={selected?.job.id === result.job.id}
              onSelect={() => setSelectedId(result.job.id)}
            />
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto bg-bg">
          {selected ? (
            <JobDetail result={selected} searchKey={searchKey} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-faint">
              {results.length > 0 ? "Select a job to see details" : "Run a search to see results here"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
