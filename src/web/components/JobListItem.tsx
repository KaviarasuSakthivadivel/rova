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
}: {
  result: JobResult;
  selected: boolean;
  onSelect: () => void;
}) {
  const { job, companyName, action, similarity, score } = result;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 border-b border-line px-4 py-3.5 text-left transition-colors ${
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
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${selected ? "font-bold text-brand-ink" : "font-semibold text-ink"}`}>{job.title}</p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {companyName}
          {job.location ? ` · ${job.location}` : ""}
        </p>
      </div>
    </button>
  );
}
