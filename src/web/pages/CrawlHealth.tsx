import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "@/web/lib/api";

function statusBadgeClass(status: string): string {
  if (status === "success") return "bg-success-subtle text-success";
  if (status === "failed") return "bg-danger-subtle text-danger";
  return "bg-bg-muted text-fg-muted";
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">Crawl health</h1>
        <button
          type="button"
          disabled={triggerMutation.isPending}
          onClick={() => triggerMutation.mutate()}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {triggerMutation.isPending ? "Starting…" : "Run crawl now"}
        </button>
      </div>

      {triggerError && <p className="mt-3 rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger">{triggerError}</p>}
      {triggerMutation.isSuccess && !triggerError && (
        <p className="mt-3 rounded-md bg-success-subtle px-3 py-2 text-sm text-success">
          Crawl started — this list updates automatically.
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        {runsQuery.isLoading && <p className="p-4 text-sm text-fg-muted">Loading…</p>}
        {runsQuery.isError && <p className="p-4 text-sm text-danger">Failed to load crawl runs.</p>}
        {runsQuery.data && runsQuery.data.runs.length === 0 && <p className="p-4 text-sm text-fg-muted">No crawl runs yet.</p>}

        {runsQuery.data && runsQuery.data.runs.length > 0 && (
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg-subtle text-left text-xs font-medium text-fg-muted">
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Seen</th>
                <th className="px-3 py-2">Added</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2">Closed</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {runsQuery.data.runs.map((run) => (
                <tr key={run.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-sans font-medium text-fg">{run.companyName}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(run.status)}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-fg-muted">{formatDuration(run.startedAt, run.finishedAt)}</td>
                  <td className="px-3 py-2 text-fg-muted">{run.jobsSeen ?? "—"}</td>
                  <td className="px-3 py-2 text-success">{run.jobsAdded ? `+${run.jobsAdded}` : "—"}</td>
                  <td className="px-3 py-2 text-fg-muted">{run.jobsUpdated ?? "—"}</td>
                  <td className="px-3 py-2 text-danger">{run.jobsClosed ? `−${run.jobsClosed}` : "—"}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-danger" title={run.errorMessage ?? undefined}>
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
