import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "@/web/lib/api";

function statusBadgeClass(status: string): string {
  if (status === "success") return "border-moss text-moss bg-moss-tint";
  if (status === "failed") return "border-rust text-rust-dim bg-rust-tint";
  return "border-rule-strong text-ink-soft bg-paper-dim";
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
    // Poll while a crawl looks to be in flight (a "running" row present),
    // so progress shows up without the user manually refreshing — stops
    // on its own once every row has settled to success/failed.
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
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-rule-strong pb-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-faint">Admin</p>
          <h1 className="mt-1 font-display text-4xl font-medium text-ink">Crawl health</h1>
        </div>
        <button
          type="button"
          disabled={triggerMutation.isPending}
          onClick={() => triggerMutation.mutate()}
          className="shrink-0 bg-ink px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-paper transition-colors hover:bg-rust disabled:opacity-50"
        >
          {triggerMutation.isPending ? "Starting…" : "Run crawl now"}
        </button>
      </div>

      {triggerError && (
        <p className="mt-4 border-l-2 border-rust bg-rust-tint px-3 py-2 text-sm text-rust-dim">{triggerError}</p>
      )}
      {triggerMutation.isSuccess && !triggerError && (
        <p className="mt-4 border-l-2 border-moss bg-moss-tint px-3 py-2 text-sm text-moss">
          Crawl started — this list updates automatically.
        </p>
      )}

      <div className="mt-6 overflow-x-auto">
        {runsQuery.isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
        {runsQuery.isError && (
          <p className="border-l-2 border-rust bg-rust-tint px-3 py-2 text-sm text-rust-dim">Failed to load crawl runs.</p>
        )}

        {runsQuery.data && runsQuery.data.runs.length === 0 && (
          <p className="text-sm text-ink-soft">No crawl runs yet.</p>
        )}

        {runsQuery.data && runsQuery.data.runs.length > 0 && (
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-rule-strong text-left text-xs font-semibold uppercase tracking-wide text-ink-faint">
                <th className="py-2.5 pr-4">Company</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 pr-4">Started</th>
                <th className="py-2.5 pr-4">Duration</th>
                <th className="py-2.5 pr-4">Seen</th>
                <th className="py-2.5 pr-4">Added</th>
                <th className="py-2.5 pr-4">Updated</th>
                <th className="py-2.5 pr-4">Closed</th>
                <th className="py-2.5 pr-4">Error</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px]">
              {runsQuery.data.runs.map((run) => (
                <tr key={run.id} className="border-b border-rule">
                  <td className="py-2.5 pr-4 font-sans font-semibold text-ink">{run.companyName}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`border px-2 py-0.5 text-[11px] font-semibold uppercase ${statusBadgeClass(run.status)}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-ink-soft">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-ink-soft">{formatDuration(run.startedAt, run.finishedAt)}</td>
                  <td className="py-2.5 pr-4 text-ink-soft">{run.jobsSeen ?? "—"}</td>
                  <td className="py-2.5 pr-4 text-moss">{run.jobsAdded ? `+${run.jobsAdded}` : "—"}</td>
                  <td className="py-2.5 pr-4 text-ink-soft">{run.jobsUpdated ?? "—"}</td>
                  <td className="py-2.5 pr-4 text-rust-dim">{run.jobsClosed ? `−${run.jobsClosed}` : "—"}</td>
                  <td className="max-w-xs truncate py-2.5 pr-4 text-rust-dim" title={run.errorMessage ?? undefined}>
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
