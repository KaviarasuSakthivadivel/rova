import { Link } from "react-router-dom";
import { Icon, ICONS } from "@/web/components/Icon";

// Small icon-only add-to-pipeline control shared by JobCard (grid) and
// JobListItem (list) — a compact stand-in for JobDetail's full "+ Add to
// pipeline" button, since a card/row has no room for button text and
// needs a click target that doesn't also trigger the card's own onSelect.
export function PipelineAddButton({
  jobId,
  inPipeline,
  isAdding,
  onAdd,
}: {
  jobId: string;
  inPipeline: boolean;
  isAdding: boolean;
  onAdd: () => void;
}) {
  if (inPipeline) {
    return (
      <Link
        to={`/pipeline/${jobId}`}
        onClick={(e) => e.stopPropagation()}
        title="In your pipeline"
        aria-label="In your pipeline"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-ink"
      >
        <Icon path={ICONS.inPipeline} className="h-3.5 w-3.5" />
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled={isAdding}
      title="Add to pipeline"
      aria-label="Add to pipeline"
      onClick={(e) => {
        e.stopPropagation();
        onAdd();
      }}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-panel-soft text-ink-faint transition-colors hover:bg-brand hover:text-white disabled:opacity-50"
    >
      <Icon path={ICONS.addToPipeline} className="h-3.5 w-3.5" />
    </button>
  );
}
