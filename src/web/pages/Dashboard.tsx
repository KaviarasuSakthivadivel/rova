import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { FiltersPanel } from "@/web/components/FiltersPanel";
import { JobCard } from "@/web/components/JobCard";
import { JobDetail } from "@/web/components/JobDetail";
import { JobDetailModal } from "@/web/components/JobDetailModal";
import { JobListItem } from "@/web/components/JobListItem";
import { LocationFilter } from "@/web/components/LocationFilter";
import { ApiError, api } from "@/web/lib/api";

const MODE_LABEL: Record<string, string> = {
  keyword: "Keyword search",
  similarity: "Semantic similarity",
  ranked: "AI-ranked to your profile",
};

const POSTED_WITHIN_OPTIONS: { label: string; days: number | undefined }[] = [
  { label: "Any time", days: undefined },
  { label: "Last 24 hours", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
];

const PAGE_SIZE = 30;

/** Fires `onTrigger` once whenever the sentinel element scrolls into
 * view — the load-more mechanism for both the list and grid views. A
 * plain "load more" button would work too, but a job board is exactly
 * the kind of endless-list page users expect to just keep scrolling. */
function useInfiniteScrollSentinel(onTrigger: () => void, enabled: boolean) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !enabled) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onTrigger();
      },
      { rootMargin: "400px" }, // start loading before the sentinel is actually on screen
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onTrigger, enabled]);

  return sentinelRef;
}

export function Dashboard() {
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [postedWithinDays, setPostedWithinDays] = useState<number | undefined>(undefined);
  const [submitted, setSubmitted] = useState({ q: "", location: "", semantic: false, postedWithinDays: undefined as number | undefined });
  // Chip filters apply immediately on click — unlike the text/location/
  // posted-date controls above, there's no "still typing" state to wait
  // out, so gating these behind the Search button would just be an extra
  // click for no benefit.
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [seniority, setSeniority] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "grid">("list");

  // Only fetched for the "scoped to your preferred..." hint below — see
  // GET /api/jobs's own comment on why "Match to me" falls back to these
  // whenever the request itself doesn't specify a location/seniority.
  const preferences = useQuery({ queryKey: ["profile"], queryFn: () => api.getProfile() }).data?.profile?.preferences;

  const searchKey = ["jobs", submitted.q, submitted.location, submitted.semantic, submitted.postedWithinDays, companyIds, seniority];
  const jobsQuery = useInfiniteQuery({
    queryKey: searchKey,
    queryFn: ({ pageParam }) =>
      api.searchJobs({
        q: submitted.q || undefined,
        location: submitted.location || undefined,
        semantic: submitted.semantic,
        postedWithinDays: submitted.postedWithinDays,
        companyIds,
        seniority,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastOffset) => (lastPage.hasMore ? lastOffset + lastPage.jobs.length : undefined),
  });

  const results = jobsQuery.data?.pages.flatMap((p) => p.jobs) ?? [];
  const mode = jobsQuery.data?.pages[0]?.mode;
  const selected = results.find((r) => r.job.id === selectedId) ?? (view === "list" ? results[0] : null) ?? null;

  const loadMore = () => {
    if (jobsQuery.hasNextPage && !jobsQuery.isFetchingNextPage) jobsQuery.fetchNextPage();
  };
  const listSentinelRef = useInfiniteScrollSentinel(loadMore, view === "list");
  const gridSentinelRef = useInfiniteScrollSentinel(loadMore, view === "grid");

  useEffect(() => {
    setSelectedId(null);
  }, [submitted]);

  // Switching views shouldn't carry a stale selection over — most
  // noticeably, a card clicked in grid view before switching to list
  // shouldn't leave list view's detail pane on something unexpected, and
  // switching back to grid shouldn't pop the modal back open unprompted.
  useEffect(() => {
    setSelectedId(null);
  }, [view]);

  // Read the "new since last visit" count/cutoff first, then mark seen —
  // the mark-seen call must fire after, or the count it's based on would
  // already reflect the timestamp it's about to overwrite.
  const newCountQuery = useQuery({ queryKey: ["jobs-new-count"], queryFn: () => api.getNewJobsCount() });
  useEffect(() => {
    api.markJobsSeen();
  }, []);

  // One shared "which jobs are already in my pipeline" set + one shared
  // add mutation, used by every card/row on the page — a per-card query
  // (mirroring how JobDetail checks a single job) would mean 30+
  // concurrent requests every time a page of results loads.
  const queryClient = useQueryClient();
  const packetsQuery = useQuery({ queryKey: ["packets"], queryFn: () => api.listPackets() });
  const pipelineJobIds = useMemo(() => new Set(packetsQuery.data?.packets.map((p) => p.packet.jobId) ?? []), [packetsQuery.data]);
  const addToPipelineMutation = useMutation({
    mutationFn: (jobId: string) => api.addToPipeline(jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["packets"] }),
  });

  const semanticError =
    jobsQuery.isError && jobsQuery.error instanceof ApiError && jobsQuery.error.status === 400 ? jobsQuery.error.message : null;

  const activeFilterCount = companyIds.length + seniority.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line bg-panel px-6 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({ q, location, semantic, postedWithinDays });
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
            className="min-w-[160px] flex-1 rounded-md bg-panel-soft px-4 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-40"
          />
          <LocationFilter
            value={location}
            onChange={setLocation}
            onSelect={(loc) => {
              setLocation(loc);
              setSubmitted((prev) => ({ ...prev, location: loc }));
            }}
            scopeParams={{
              q: submitted.q || undefined,
              semantic: submitted.semantic,
              postedWithinDays: submitted.postedWithinDays,
              companyIds,
              seniority,
            }}
          />
          <select
            value={postedWithinDays ?? ""}
            onChange={(e) => setPostedWithinDays(e.target.value ? Number(e.target.value) : undefined)}
            className="rounded-md bg-panel-soft px-3 py-1.5 text-sm text-ink-muted focus:outline-none"
          >
            {POSTED_WITHIN_OPTIONS.map((opt) => (
              <option key={opt.label} value={opt.days ?? ""}>
                {opt.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} className="h-3.5 w-3.5 accent-brand" />
            Match to me
          </label>
          <button type="submit" className="rounded-md bg-brand px-4 py-1.5 text-sm font-bold text-white hover:bg-brand-dark">
            Search
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={`flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-bold ${
              filtersOpen || activeFilterCount > 0 ? "bg-brand-soft text-brand-ink" : "bg-panel-soft text-ink-muted hover:bg-line"
            }`}
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>

          <div className="ml-auto flex shrink-0 gap-1 rounded-md bg-panel-soft p-1">
            <button
              type="button"
              onClick={() => setView("list")}
              aria-label="List view"
              className={`rounded-md px-2.5 py-1 text-xs font-bold ${view === "list" ? "bg-brand text-white" : "text-ink-faint hover:text-ink"}`}
            >
              ☰ List
            </button>
            <button
              type="button"
              onClick={() => setView("grid")}
              aria-label="Grid view"
              className={`rounded-md px-2.5 py-1 text-xs font-bold ${view === "grid" ? "bg-brand text-white" : "text-ink-faint hover:text-ink"}`}
            >
              ⊞ Grid
            </button>
          </div>
        </form>
        {jobsQuery.data && (
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {mode ? (MODE_LABEL[mode] ?? mode) : ""} · {results.length} loaded{jobsQuery.hasNextPage ? "+" : ""}
            {submitted.semantic &&
              (() => {
                const usingLocations = !submitted.location && !!preferences?.locations?.length;
                const usingSeniority = seniority.length === 0 && !!preferences?.seniority?.length;
                if (!usingLocations && !usingSeniority) return null;
                const scoped = [usingLocations && "locations", usingSeniority && "seniority"].filter(Boolean).join(" & ");
                return <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-faint">· scoped to your preferred {scoped} (edit in Profile)</span>;
              })()}
          </p>
        )}
        {!!newCountQuery.data?.count && (
          <p className="mt-2 rounded-xl bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand-ink">
            {newCountQuery.data.count} new job{newCountQuery.data.count === 1 ? "" : "s"} since you last checked
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {filtersOpen && (
          <FiltersPanel
            selectedCompanyIds={companyIds}
            onToggleCompany={(id) => setCompanyIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
            selectedSeniority={seniority}
            onToggleSeniority={(bucket) => setSeniority((prev) => (prev.includes(bucket) ? prev.filter((x) => x !== bucket) : [...prev, bucket]))}
            onClear={() => {
              setCompanyIds([]);
              setSeniority([]);
            }}
            onClose={() => setFiltersOpen(false)}
            searchParams={{
              q: submitted.q || undefined,
              location: submitted.location || undefined,
              semantic: submitted.semantic,
              postedWithinDays: submitted.postedWithinDays,
            }}
          />
        )}

        {view === "list" ? (
          <div className="flex min-h-0 flex-1">
            <div className="w-[340px] shrink-0 overflow-y-auto border-r border-line bg-panel sm:w-[380px]">
              {jobsQuery.isLoading && <p className="p-4 text-sm text-ink-muted">Loading…</p>}
              {semanticError && <p className="m-4 rounded-xl bg-red-soft px-3 py-2.5 text-sm text-red">{semanticError}</p>}
              {jobsQuery.isError && !semanticError && <p className="m-4 rounded-xl bg-red-soft px-3 py-2.5 text-sm text-red">Failed to load jobs.</p>}
              {jobsQuery.data && results.length === 0 && <p className="p-4 text-sm text-ink-muted">No jobs match yet.</p>}
              {results.map((result) => (
                <JobListItem
                  key={result.job.id}
                  result={result}
                  selected={selected?.job.id === result.job.id}
                  onSelect={() => setSelectedId(result.job.id)}
                  newSince={newCountQuery.data?.since ?? null}
                  inPipeline={pipelineJobIds.has(result.job.id)}
                  isAddingToPipeline={addToPipelineMutation.isPending && addToPipelineMutation.variables === result.job.id}
                  onAddToPipeline={() => addToPipelineMutation.mutate(result.job.id)}
                />
              ))}
              {results.length > 0 && (
                <div ref={listSentinelRef} className="p-4 text-center text-xs text-ink-faint">
                  {jobsQuery.isFetchingNextPage ? "Loading more…" : jobsQuery.hasNextPage ? "" : "You've reached the end."}
                </div>
              )}
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
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto bg-bg p-6">
            {jobsQuery.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
            {semanticError && <p className="mb-4 rounded-xl bg-red-soft px-3 py-2.5 text-sm text-red">{semanticError}</p>}
            {jobsQuery.isError && !semanticError && <p className="mb-4 rounded-xl bg-red-soft px-3 py-2.5 text-sm text-red">Failed to load jobs.</p>}
            {jobsQuery.data && results.length === 0 && <p className="text-sm text-ink-muted">No jobs match yet.</p>}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {results.map((result) => (
                <JobCard
                  key={result.job.id}
                  result={result}
                  onSelect={() => setSelectedId(result.job.id)}
                  newSince={newCountQuery.data?.since ?? null}
                  inPipeline={pipelineJobIds.has(result.job.id)}
                  isAddingToPipeline={addToPipelineMutation.isPending && addToPipelineMutation.variables === result.job.id}
                  onAddToPipeline={() => addToPipelineMutation.mutate(result.job.id)}
                />
              ))}
            </div>

            {results.length > 0 && (
              <div ref={gridSentinelRef} className="p-4 text-center text-xs text-ink-faint">
                {jobsQuery.isFetchingNextPage ? "Loading more…" : jobsQuery.hasNextPage ? "" : "You've reached the end."}
              </div>
            )}

            {selected && view === "grid" && <JobDetailModal result={selected} searchKey={searchKey} onClose={() => setSelectedId(null)} />}
          </div>
        )}
      </div>
    </div>
  );
}
