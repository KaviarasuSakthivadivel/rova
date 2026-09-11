import { useQuery } from "@tanstack/react-query";
import { api } from "@/web/lib/api";

function statusBadgeClass(status: string): string {
  if (status === "success") return "bg-emerald-50 text-emerald-700";
  if (status === "failed") return "bg-red-50 text-red-700";
  return "bg-slate-100 text-slate-600";
}

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "running…";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return `${(ms / 1000).toFixed(1)}s`;
}

export function CrawlHealth() {
  const runsQuery = useQuery({ queryKey: ["crawl-runs"], queryFn: () => api.getCrawlRuns(50) });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Crawl health</h1>
      <p className="mt-1 text-sm text-slate-500">Most recent crawl runs across every tracked company.</p>

      <div className="mt-6 overflow-x-auto">
        {runsQuery.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {runsQuery.isError && <p className="text-sm text-red-600">Failed to load crawl runs.</p>}

        {runsQuery.data && runsQuery.data.runs.length === 0 && (
          <p className="text-sm text-slate-500">No crawl runs yet.</p>
        )}

        {runsQuery.data && runsQuery.data.runs.length > 0 && (
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Company</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Started</th>
                <th className="py-2 pr-4">Duration</th>
                <th className="py-2 pr-4">Seen</th>
                <th className="py-2 pr-4">Added</th>
                <th className="py-2 pr-4">Updated</th>
                <th className="py-2 pr-4">Closed</th>
                <th className="py-2 pr-4">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runsQuery.data.runs.map((run) => (
                <tr key={run.id}>
                  <td className="py-2 pr-4 font-medium text-slate-900">{run.companyName}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(run.status)}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-slate-500">{new Date(run.startedAt).toLocaleString()}</td>
                  <td className="py-2 pr-4 text-slate-500">{formatDuration(run.startedAt, run.finishedAt)}</td>
                  <td className="py-2 pr-4 text-slate-500">{run.jobsSeen ?? "—"}</td>
                  <td className="py-2 pr-4 text-slate-500">{run.jobsAdded ?? "—"}</td>
                  <td className="py-2 pr-4 text-slate-500">{run.jobsUpdated ?? "—"}</td>
                  <td className="py-2 pr-4 text-slate-500">{run.jobsClosed ?? "—"}</td>
                  <td className="max-w-xs truncate py-2 pr-4 text-red-600" title={run.errorMessage ?? undefined}>
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
