import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/web/lib/api";
import type { JobResult } from "@/web/lib/types";

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export function JobCard({ result, searchKey }: { result: JobResult; searchKey: unknown[] }) {
  const { job, companyName, action, similarity, score, reasons } = result;
  const queryClient = useQueryClient();

  const actMutation = useMutation({
    mutationFn: (next: "saved" | "dismissed") => api.actOnJob(job.id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: searchKey }),
  });

  return (
    <article
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${action === "dismissed" ? "opacity-50" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-900">
            <a href={job.jobUrl} target="_blank" rel="noreferrer" className="hover:underline">
              {job.title}
            </a>
          </h3>
          <p className="mt-0.5 text-sm text-slate-600">
            {companyName}
            {job.location ? ` · ${job.location}` : ""}
            {job.department ? ` · ${job.department}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {typeof score === "number" && (
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
              {score}% fit
            </span>
          )}
          {typeof score !== "number" && typeof similarity === "number" && (
            <span
              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
              title="Raw semantic similarity — a rough ordering signal, not a calibrated quality score. Configure Claude ranking for a real fit score."
            >
              {Math.round(similarity * 100)}% similar
            </span>
          )}
          <span className="text-xs text-slate-400">{timeAgo(job.firstSeenAt)}</span>
        </div>
      </div>

      {reasons && reasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {reasons.map((reason) => (
            <li key={reason} className="text-sm text-slate-500">
              · {reason}
            </li>
          ))}
        </ul>
      ) : (
        job.description && <p className="mt-2 line-clamp-2 text-sm text-slate-500">{job.description}</p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={actMutation.isPending}
          onClick={() => actMutation.mutate("saved")}
          className={`rounded-md border px-3 py-1 text-xs font-medium ${
            action === "saved"
              ? "border-emerald-600 bg-emerald-50 text-emerald-700"
              : "border-slate-300 text-slate-600 hover:bg-slate-50"
          }`}
        >
          {action === "saved" ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          disabled={actMutation.isPending}
          onClick={() => actMutation.mutate("dismissed")}
          className={`rounded-md border px-3 py-1 text-xs font-medium ${
            action === "dismissed"
              ? "border-slate-400 bg-slate-100 text-slate-600"
              : "border-slate-300 text-slate-600 hover:bg-slate-50"
          }`}
        >
          {action === "dismissed" ? "Dismissed" : "Dismiss"}
        </button>
      </div>
    </article>
  );
}
