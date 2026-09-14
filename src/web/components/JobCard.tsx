import { CompanyLogo } from "@/web/components/CompanyLogo";
import { PipelineAddButton } from "@/web/components/PipelineAddButton";
import type { JobResult } from "@/web/lib/types";

function scoreColor(score: number): string {
  if (score >= 80) return "text-brand";
  if (score >= 60) return "text-gold";
  return "text-ink-faint";
}

// Grid-view counterpart to JobListItem — same underlying data and click
// contract (onSelect opens the same JobDetail), laid out as a self-
// contained card instead of a row in a narrow list. A plain <div> with
// role="button", not a real <button> — PipelineAddButton renders its own
// button/link, and nesting interactive elements breaks both click
// targeting and HTML validity.
export function JobCard({
  result,
  onSelect,
  newSince,
  inPipeline,
  isAddingToPipeline,
  onAddToPipeline,
}: {
  result: JobResult;
  onSelect: () => void;
  newSince?: string | null;
  inPipeline: boolean;
  isAddingToPipeline: boolean;
  onAddToPipeline: () => void;
}) {
  const { job, companyName, companyDomain, action, similarity, score } = result;
  const isNew = !!newSince && job.firstSeenAt > newSince;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`flex h-full cursor-pointer flex-col items-start gap-3 rounded-2xl border border-line bg-panel p-4 text-left transition-colors hover:border-brand/40 hover:bg-panel-soft ${
        action === "dismissed" ? "opacity-40" : ""
      }`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <CompanyLogo name={companyName} domain={companyDomain} size="md" />
        <div className="flex shrink-0 items-center gap-2">
          {typeof score === "number" ? (
            <span className={`font-mono text-sm font-bold ${scoreColor(score)}`}>{score}</span>
          ) : typeof similarity === "number" ? (
            <span className="font-mono text-xs text-ink-faint">{Math.round(similarity * 100)}%</span>
          ) : action === "saved" ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
          ) : null}
          <PipelineAddButton jobId={job.id} inPipeline={inPipeline} isAdding={isAddingToPipeline} onAdd={onAddToPipeline} />
        </div>
      </div>

      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-ink">
          {job.title}
          {isNew && (
            <span className="shrink-0 rounded-full bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-ink">
              New
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {companyName}
          {job.location ? ` · ${job.location}` : ""}
        </p>
      </div>

      {job.summary && <p className="line-clamp-2 text-xs leading-relaxed text-ink-faint">{job.summary}</p>}
    </div>
  );
}
