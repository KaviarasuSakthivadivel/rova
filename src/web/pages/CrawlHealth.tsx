import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "@/web/lib/api";

function statusColor(status: string): string {
  if (status === "success") return "text-brand";
  if (status === "failed") return "text-red";
  return "text-ink-faint";
}

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "running…";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

export function CrawlHealth() {
  const queryClient = useQueryClient();
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ["crawl-runs"],
    queryFn: () => api.getCrawlRuns(50),
    refetchInterval: (query) => (query.state.data?.runs.some((r) => r.status === "running") ? 2000 : false),
  });

  const triggerMutation = useMutation({
    mutationFn: () => api.triggerCrawl(),
    onSuccess: () => {
      setTriggerError(null);
      queryClient.invalidateQueries({ queryKey: ["crawl-runs"] });
    },
    onError: (err) => {
      setTriggerError(err instanceof ApiError ? err.message : "Failed to start crawl");
    },
  });

  return (
    <div className="h-full max-w-5xl overflow-y-auto px-6 py-8 sm:px-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">Crawl health</h1>
        <button
          type="button"
          disabled={triggerMutation.isPending}
          onClick={() => triggerMutation.mutate()}
          className="rounded-md bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {triggerMutation.isPending ? "Starting…" : "Run crawl now"}
        </button>
      </div>

      {triggerError && <p className="mt-4 rounded-xl bg-red-soft px-4 py-2.5 text-sm text-red">{triggerError}</p>}
      {triggerMutation.isSuccess && !triggerError && (
        <p className="mt-4 rounded-xl bg-brand-soft px-4 py-2.5 text-sm text-brand-ink">
          Crawl started — this list updates automatically.
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-2xl bg-panel shadow-sm">
        {runsQuery.isLoading && <p className="p-5 text-sm text-ink-muted">Loading…</p>}
        {runsQuery.isError && <p className="p-5 text-sm text-red">Failed to load crawl runs.</p>}
        {runsQuery.data && runsQuery.data.runs.length === 0 && <p className="p-5 text-sm text-ink-muted">No crawl runs yet.</p>}

        {runsQuery.data && runsQuery.data.runs.length > 0 && (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-ink-faint">
                <th className="px-5 pb-2 pt-5">Company</th>
                <th className="px-3 pb-2 pt-5">Status</th>
                <th className="px-3 pb-2 pt-5">Started</th>
                <th className="px-3 pb-2 pt-5">Duration</th>
                <th className="px-3 pb-2 pt-5">Seen</th>
                <th className="px-3 pb-2 pt-5">Added</th>
                <th className="px-3 pb-2 pt-5">Updated</th>
                <th className="px-3 pb-2 pt-5">Closed</th>
                <th className="px-3 pb-2 pt-5">Error</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {runsQuery.data.runs.map((run) => (
                <tr key={run.id} className="border-t border-line">
                  <td className="px-5 py-3 font-sans font-semibold text-ink">{run.companyName}</td>
                  <td className={`px-3 py-3 font-sans font-semibold ${statusColor(run.status)}`}>{run.status}</td>
                  <td className="px-3 py-3 text-ink-muted">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="px-3 py-3 text-ink-muted">{formatDuration(run.startedAt, run.finishedAt)}</td>
                  <td className="px-3 py-3 text-ink-muted">{run.jobsSeen ?? "—"}</td>
                  <td className="px-3 py-3 text-brand">{run.jobsAdded ? `+${run.jobsAdded}` : "—"}</td>
                  <td className="px-3 py-3 text-ink-muted">{run.jobsUpdated ?? "—"}</td>
                  <td className="px-3 py-3 text-red">{run.jobsClosed ? `−${run.jobsClosed}` : "—"}</td>
                  <td className="max-w-xs truncate px-3 py-3 text-red" title={run.errorMessage ?? undefined}>
                    {run.errorMessage ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
