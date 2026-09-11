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
    <article className={`border border-ink bg-paper p-5 ${action === "dismissed" ? "opacity-45" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-display text-xl font-medium text-ink">
            <a href={job.jobUrl} target="_blank" rel="noreferrer" className="hover:text-rust">
              {job.title}
            </a>
          </h3>
          <p className="mt-1 text-sm text-ink-soft">
            <span className="font-semibold">{companyName}</span>
            {job.location ? ` — ${job.location}` : ""}
            {job.department ? ` · ${job.department}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {typeof score === "number" && (
            <div className="flex items-baseline gap-1 border border-rust bg-rust-tint px-2.5 py-1">
              <span className="font-mono text-lg font-semibold leading-none text-rust-dim">{score}</span>
              <span className="font-mono text-[10px] uppercase tracking-wide text-rust-dim/80">fit</span>
            </div>
          )}
          {typeof score !== "number" && typeof similarity === "number" && (
            <div
              className="border border-rule-strong px-2.5 py-1 font-mono text-xs text-ink-soft"
              title="Raw semantic similarity — a rough ordering signal, not a calibrated quality score. Configure Claude ranking for a real fit score."
            >
              ~{Math.round(similarity * 100)}% similar
            </div>
          )}
          <span className="font-mono text-[11px] text-ink-faint">{timeAgo(job.firstSeenAt)}</span>
        </div>
      </div>

      {reasons && reasons.length > 0 ? (
        <ul className="mt-3 space-y-1 border-l-2 border-rule pl-3">
          {reasons.map((reason) => (
            <li key={reason} className="text-sm text-ink-soft">
              {reason}
            </li>
          ))}
        </ul>
      ) : (
        job.description && <p className="mt-3 line-clamp-2 text-sm text-ink-soft">{job.description}</p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          disabled={actMutation.isPending}
          onClick={() => actMutation.mutate("saved")}
          className={`border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
            action === "saved" ? "border-moss bg-moss-tint text-moss" : "border-ink text-ink hover:bg-ink hover:text-paper"
          }`}
        >
          {action === "saved" ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          disabled={actMutation.isPending}
          onClick={() => actMutation.mutate("dismissed")}
          className={`border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
            action === "dismissed" ? "border-ink-faint text-ink-faint" : "border-rule text-ink-soft hover:border-ink hover:text-ink"
          }`}
        >
          {action === "dismissed" ? "Dismissed" : "Dismiss"}
        </button>
      </div>
    </article>
  );
}
