import { useEffect } from "react";
import { JobDetail } from "@/web/components/JobDetail";
import type { JobResult } from "@/web/lib/types";

// Grid view has no side pane to render JobDetail into, so a card click
// opens it as an overlay instead — same JobDetail component/behavior as
// master-detail, just presented differently.
export function JobDetailModal({ result, searchKey, onClose }: { result: JobResult; searchKey: unknown[]; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-ink/30 p-4 sm:p-8" onClick={onClose}>
      <div
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl bg-bg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex justify-end bg-bg/80 px-4 pt-3 backdrop-blur-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-panel-soft px-3 py-1 text-xs font-bold text-ink-muted hover:bg-line"
          >
            ✕ Close
          </button>
        </div>
        <JobDetail result={result} searchKey={searchKey} />
      </div>
    </div>
  );
}
