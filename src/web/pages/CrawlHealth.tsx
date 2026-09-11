import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "@/web/lib/api";

function statusBadgeClass(status: string): string {
  if (status === "success") return "bg-tertiary-container text-on-tertiary-container";
  if (status === "failed") return "bg-error-container text-on-error-container";
  return "bg-secondary-container text-on-secondary-container";
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
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-normal text-on-surface">Crawl health</h1>
          <p className="mt-1 text-sm text-on-surface-variant">Most recent crawl runs across every tracked company.</p>
        </div>
        <button
          type="button"
          disabled={triggerMutation.isPending}
          onClick={() => triggerMutation.mutate()}
          className="state-layer shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-on-primary shadow-sm disabled:opacity-50"
        >
          {triggerMutation.isPending ? "Starting…" : "Run crawl now"}
        </button>
      </div>

      {triggerError && (
        <p className="mt-4 rounded-xl bg-error-container px-4 py-2.5 text-sm text-on-error-container">{triggerError}</p>
      )}
      {triggerMutation.isSuccess && !triggerError && (
        <p className="mt-4 rounded-xl bg-tertiary-container px-4 py-2.5 text-sm text-on-tertiary-container">
          Crawl started — this list updates automatically.
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container-lowest">
        {runsQuery.isLoading && <p className="p-5 text-sm text-on-surface-variant">Loading…</p>}
        {runsQuery.isError && (
          <p className="p-5 text-sm text-on-error-container">Failed to load crawl runs.</p>
        )}
        {runsQuery.data && runsQuery.data.runs.length === 0 && (
          <p className="p-5 text-sm text-on-surface-variant">No crawl runs yet.</p>
        )}

        {runsQuery.data && runsQuery.data.runs.length > 0 && (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant text-left text-xs font-medium text-on-surface-variant">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Seen</th>
                <th className="px-4 py-3">Added</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Closed</th>
                <th className="px-4 py-3">Error</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {runsQuery.data.runs.map((run) => (
                <tr key={run.id} className="border-b border-outline-variant/60 last:border-0">
                  <td className="px-4 py-3 font-sans font-medium text-on-surface">{run.companyName}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(run.status)}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-on-surface-variant">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{formatDuration(run.startedAt, run.finishedAt)}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{run.jobsSeen ?? "—"}</td>
                  <td className="px-4 py-3 text-on-tertiary-container">{run.jobsAdded ? `+${run.jobsAdded}` : "—"}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{run.jobsUpdated ?? "—"}</td>
                  <td className="px-4 py-3 text-on-error-container">{run.jobsClosed ? `−${run.jobsClosed}` : "—"}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-on-error-container" title={run.errorMessage ?? undefined}>
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
