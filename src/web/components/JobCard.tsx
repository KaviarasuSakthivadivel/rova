import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/web/lib/api";
import type { JobResult } from "@/web/lib/types";

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function scoreTone(score: number): string {
  if (score >= 80) return "bg-tertiary-container text-on-tertiary-container";
  if (score >= 60) return "bg-secondary-container text-on-secondary-container";
  return "bg-surface-container-high text-on-surface-variant";
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
      className={`rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 shadow-sm transition-shadow hover:shadow-md ${
        action === "dismissed" ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-medium text-on-surface">
            <a href={job.jobUrl} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">
              {job.title}
            </a>
          </h3>
          <p className="mt-0.5 text-sm text-on-surface-variant">
            <span className="font-medium text-on-surface">{companyName}</span>
            {job.location ? ` · ${job.location}` : ""}
            {job.department ? ` · ${job.department}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {typeof score === "number" && (
            <div className={`flex h-9 w-9 items-center justify-center rounded-full font-mono text-sm font-semibold ${scoreTone(score)}`}>
              {score}
            </div>
          )}
          {typeof score !== "number" && typeof similarity === "number" && (
            <div
              className="rounded-full bg-surface-container-high px-2.5 py-1 font-mono text-xs text-on-surface-variant"
              title="Raw semantic similarity — a rough ordering signal, not a calibrated score. Configure Claude ranking for a real fit score."
            >
              ~{Math.round(similarity * 100)}%
            </div>
          )}
          <span className="text-xs text-on-surface-variant">{timeAgo(job.firstSeenAt)}</span>
        </div>
      </div>

      {/* AI fit reasons (ranked mode) take priority; otherwise the
          one-sentence summary; raw description is the last resort for
          jobs the summarizer hasn't reached yet. */}
      {reasons && reasons.length > 0 ? (
        <ul className="mt-3 space-y-1 border-l-2 border-primary-container pl-3">
          {reasons.map((reason) => (
            <li key={reason} className="text-sm text-on-surface-variant">
              {reason}
            </li>
          ))}
        </ul>
      ) : job.summary ? (
        <p className="mt-3 text-sm text-on-surface-variant">{job.summary}</p>
      ) : (
        job.description && <p className="mt-3 line-clamp-2 text-sm text-on-surface-variant/70">{job.description}</p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={actMutation.isPending}
          onClick={() => actMutation.mutate("saved")}
          className={`state-layer rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
            action === "saved"
              ? "bg-tertiary-container text-on-tertiary-container"
              : "border border-outline text-on-surface-variant"
          }`}
        >
          {action === "saved" ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          disabled={actMutation.isPending}
          onClick={() => actMutation.mutate("dismissed")}
          className={`state-layer rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
            action === "dismissed"
              ? "bg-surface-container-high text-on-surface-variant"
              : "border border-outline text-on-surface-variant"
          }`}
        >
          {action === "dismissed" ? "Dismissed" : "Dismiss"}
        </button>
      </div>
    </article>
  );
}
