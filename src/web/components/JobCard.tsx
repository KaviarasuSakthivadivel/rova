import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/web/lib/api";
import type { JobResult } from "@/web/lib/types";

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function scoreClass(score: number): string {
  if (score >= 80) return "bg-success-subtle text-success";
  if (score >= 60) return "bg-accent-subtle text-accent";
  return "bg-bg-muted text-fg-muted";
}

export function JobCard({ result, searchKey }: { result: JobResult; searchKey: unknown[] }) {
  const { job, companyName, action, similarity, score, reasons } = result;
  const queryClient = useQueryClient();

  const actMutation = useMutation({
    mutationFn: (next: "saved" | "dismissed") => api.actOnJob(job.id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: searchKey }),
  });

  return (
    <article className={`rounded-lg border border-border bg-bg p-4 ${action === "dismissed" ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-fg">
            <a href={job.jobUrl} target="_blank" rel="noreferrer" className="hover:text-accent">
              {job.title}
            </a>
          </h3>
          <p className="mt-0.5 text-sm text-fg-muted">
            {companyName}
            {job.location ? ` · ${job.location}` : ""}
            {job.department ? ` · ${job.department}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {typeof score === "number" && (
            <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-medium ${scoreClass(score)}`}>
              {score}
            </span>
          )}
          {typeof score !== "number" && typeof similarity === "number" && (
            <span
              className="rounded bg-bg-muted px-1.5 py-0.5 font-mono text-xs text-fg-muted"
              title="Raw semantic similarity — a rough ordering signal, not a calibrated score. Configure Claude ranking for a real fit score."
            >
              ~{Math.round(similarity * 100)}%
            </span>
          )}
          <span className="text-xs text-fg-subtle">{timeAgo(job.firstSeenAt)}</span>
        </div>
      </div>

      {reasons && reasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {reasons.map((reason) => (
            <li key={reason} className="text-sm text-fg-muted">
              · {reason}
            </li>
          ))}
        </ul>
      ) : job.summary ? (
        <p className="mt-2 text-sm text-fg-muted">{job.summary}</p>
      ) : (
        job.description && <p className="mt-2 line-clamp-2 text-sm text-fg-subtle">{job.description}</p>
      )}

      <div className="mt-3 flex gap-1.5">
        <button
          type="button"
          disabled={actMutation.isPending}
          onClick={() => actMutation.mutate("saved")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            action === "saved" ? "bg-success-subtle text-success" : "border border-border-strong text-fg-muted hover:bg-bg-muted"
          }`}
        >
          {action === "saved" ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          disabled={actMutation.isPending}
          onClick={() => actMutation.mutate("dismissed")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            action === "dismissed" ? "bg-bg-muted text-fg-subtle" : "border border-border-strong text-fg-muted hover:bg-bg-muted"
          }`}
        >
          {action === "dismissed" ? "Dismissed" : "Dismiss"}
        </button>
      </div>
    </article>
  );
}
