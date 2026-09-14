import { CompanyLogo } from "@/web/components/CompanyLogo";
import { PipelineAddButton } from "@/web/components/PipelineAddButton";
import type { JobResult } from "@/web/lib/types";

function scoreColor(score: number): string {
  if (score >= 80) return "text-brand";
  if (score >= 60) return "text-gold";
  return "text-ink-faint";
}

export function JobListItem({
  result,
  selected,
  onSelect,
  newSince,
  inPipeline,
  isAddingToPipeline,
  onAddToPipeline,
}: {
  result: JobResult;
  selected: boolean;
  onSelect: () => void;
  newSince?: string | null;
  inPipeline: boolean;
  isAddingToPipeline: boolean;
  onAddToPipeline: () => void;
}) {
  const { job, companyName, companyDomain, action, similarity, score } = result;
  const isNew = !!newSince && job.firstSeenAt > newSince;

  return (
    // A <div role="button">, not a real <button> — PipelineAddButton
    // renders its own button/link, and nesting interactive elements
    // breaks both click targeting and HTML validity.
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
      className={`flex w-full cursor-pointer items-start gap-3 border-b border-line px-4 py-3.5 text-left transition-colors ${
        selected ? "bg-brand-soft" : "hover:bg-panel-soft"
      } ${action === "dismissed" ? "opacity-40" : ""}`}
    >
      <div className="flex w-8 shrink-0 flex-col items-center pt-0.5">
        {typeof score === "number" ? (
          <span className={`font-mono text-sm font-bold ${scoreColor(score)}`}>{score}</span>
        ) : typeof similarity === "number" ? (
          <span className="font-mono text-xs text-ink-faint">{Math.round(similarity * 100)}%</span>
        ) : (
          <span className={`h-1.5 w-1.5 rounded-full ${action === "saved" ? "bg-brand" : "bg-line"}`} />
        )}
      </div>
      <CompanyLogo name={companyName} domain={companyDomain} size="sm" />
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1.5 truncate text-sm ${selected ? "font-bold text-brand-ink" : "font-semibold text-ink"}`}>
          <span className="truncate">{job.title}</span>
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
      <PipelineAddButton jobId={job.id} inPipeline={inPipeline} isAdding={isAddingToPipeline} onAdd={onAddToPipeline} />
    </div>
  );
}
