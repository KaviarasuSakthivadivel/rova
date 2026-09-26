import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CompanyLogo } from "@/web/components/CompanyLogo";
import { api } from "@/web/lib/api";
import type { JobResult } from "@/web/lib/types";

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Posted today";
  if (days === 1) return "Posted 1 day ago";
  return `Posted ${days} days ago`;
}

export function JobDetail({ result, searchKey }: { result: JobResult; searchKey: unknown[] }) {
  const { job, companyName, companyDomain, action, score, reasons } = result;
  const queryClient = useQueryClient();

  const actMutation = useMutation({
    mutationFn: (next: "saved" | "dismissed") => api.actOnJob(job.id, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: searchKey }),
  });

  // 404 just means "not added yet" — not a real error, so don't retry it.
  const packetQuery = useQuery({
    queryKey: ["packet", job.id],
    queryFn: () => api.getPacket(job.id),
    retry: false,
    throwOnError: false,
  });
  const inPipeline = packetQuery.isSuccess;

  const addToPipelineMutation = useMutation({
    mutationFn: () => api.addToPipeline(job.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["packet", job.id] }),
  });

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-3.5">
          <CompanyLogo name={companyName} domain={companyDomain} size="lg" />
          <div>
            <h2 className="text-2xl font-extrabold text-ink">{job.title}</h2>
            <p className="mt-1.5 text-ink-muted">
              <span className="font-bold text-ink">{companyName}</span>
              {job.location ? ` — ${job.location}` : ""}
            </p>
            <p className="mt-1 text-xs text-ink-faint">{timeAgo(job.firstSeenAt)}</p>
          </div>
        </div>
        {typeof score === "number" && (
          <div className="flex shrink-0 flex-col items-center rounded-2xl bg-brand-soft px-4 py-3">
            <span className="font-mono text-2xl font-extrabold text-brand-ink">{score}</span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-brand-ink/70">fit</span>
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-2.5">
        <a
          href={job.jobUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-brand px-5 py-2 text-sm font-bold text-white hover:bg-brand-dark"
        >
          View original posting ↗
        </a>
        <button
          type="button"
          disabled={actMutation.isPending}
          onClick={() => actMutation.mutate("saved")}
          className={`rounded-md px-4 py-2 text-sm font-bold ${
            action === "saved" ? "bg-gold-soft text-gold" : "bg-panel-soft text-ink-muted hover:bg-line"
          }`}
        >
          {action === "saved" ? "★ Saved" : "☆ Save"}
        </button>
        <button
          type="button"
          disabled={actMutation.isPending}
          onClick={() => actMutation.mutate("dismissed")}
          className={`rounded-md px-4 py-2 text-sm font-bold ${
            action === "dismissed" ? "bg-red-soft text-red" : "bg-panel-soft text-ink-muted hover:bg-line"
          }`}
        >
          Dismiss
        </button>

        {action === "applied" ? (
          <span className="rounded-full bg-brand-soft px-4 py-2 text-sm font-bold text-brand-ink">✓ Applied</span>
        ) : inPipeline ? (
          <Link to={`/pipeline/${job.id}`} className="rounded-md bg-panel-soft px-4 py-2 text-sm font-bold text-ink-muted hover:bg-line">
            In pipeline →
          </Link>
        ) : (
          <button
            type="button"
            disabled={addToPipelineMutation.isPending}
            onClick={() => addToPipelineMutation.mutate()}
            className="rounded-md bg-panel-soft px-4 py-2 text-sm font-bold text-ink-muted hover:bg-line disabled:opacity-50"
          >
            + Add to pipeline
          </button>
        )}
      </div>

      {reasons && reasons.length > 0 && (
        <div className="mt-8">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">Why you're seeing this</p>
          <ul className="mt-2.5 space-y-2">
            {reasons.map((reason) => (
              <li key={reason} className="flex gap-2 text-sm text-ink">
                <span className="text-brand">✓</span>
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {job.summary && (
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">Summary</p>
          <p className="mt-2 text-sm leading-relaxed text-ink">{job.summary}</p>
        </div>
      )}

      {(job.descriptionHtml || job.description) && (
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">Full description</p>
          {job.descriptionHtml ? (
            <div
              className="job-description-rich mt-2 text-sm leading-relaxed text-ink-muted"
              // Sanitized server-side (allowlisted tags only) before storage —
              // see sanitizeDescriptionHtml in src/pipeline/normalize.ts.
              dangerouslySetInnerHTML={{ __html: job.descriptionHtml }}
            />
          ) : (
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{job.description}</p>
          )}
        </div>
      )}
    </div>
  );
}
