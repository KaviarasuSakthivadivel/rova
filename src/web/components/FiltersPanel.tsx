import { useQuery } from "@tanstack/react-query";
import { api } from "@/web/lib/api";
import { SENIORITY_BUCKETS, SENIORITY_BUCKET_LABELS } from "@/web/lib/seniority";

function CheckboxRow({ checked, onChange, label, count }: { checked: boolean; onChange: () => void; label: string; count?: number }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-panel">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3.5 w-3.5 shrink-0 accent-brand" />
      <span className="min-w-0 flex-1 truncate text-ink">{label}</span>
      {typeof count === "number" && <span className="shrink-0 text-xs text-ink-faint">{count}</span>}
    </label>
  );
}

// A persistent left-sidebar panel (matching the reference product
// screenshot), not a popover — a checkbox list scales cleanly as more
// companies get tracked over time, where a row of wrapping pills would
// either overflow a fixed-width popover or keep needing repositioning.
//
// Company/seniority only — salary is left out entirely (not "shown but
// empty"): 0 of the currently crawled jobs have salary data (only the
// Lever source parser ever populates it, and no tracked company uses
// Lever), so a salary range control would just be dead UI right now.
// Workplace type/employment type stay out for the same reason. Seniority
// *is* included despite the same gap, via a title-keyword heuristic
// (src/pipeline/jobFilters.ts) — explicitly asked for, so approximate-
// but-usable beats "correct but empty" here.
export function FiltersPanel({
  selectedCompanyIds,
  onToggleCompany,
  selectedSeniority,
  onToggleSeniority,
  onClear,
  onClose,
  searchParams,
}: {
  selectedCompanyIds: string[];
  onToggleCompany: (id: string) => void;
  selectedSeniority: string[];
  onToggleSeniority: (bucket: string) => void;
  onClear: () => void;
  onClose: () => void;
  // The base search (query text/location/posted-within/semantic mode) —
  // counts are scoped to it, not a static per-company total, so they stay
  // accurate as that search changes (see GET /api/jobs/facets).
  searchParams: { q?: string; location?: string; semantic?: boolean; postedWithinDays?: number };
}) {
  const facetsQuery = useQuery({
    queryKey: ["job-facets", searchParams.q, searchParams.location, searchParams.semantic, searchParams.postedWithinDays],
    queryFn: () => api.getJobFacets(searchParams),
  });
  const activeCount = selectedCompanyIds.length + selectedSeniority.length;

  return (
    <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-line bg-panel-soft">
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">Filters</p>
        <button type="button" onClick={onClose} aria-label="Close filters" className="text-ink-faint hover:text-ink">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {activeCount > 0 && (
          <button type="button" onClick={onClear} className="mb-2 px-2 text-xs font-semibold text-brand-ink hover:underline">
            Clear all ({activeCount})
          </button>
        )}

        <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint">Company</p>
        {facetsQuery.isLoading && <p className="px-2 text-xs text-ink-faint">Loading…</p>}
        {facetsQuery.data && facetsQuery.data.companies.length === 0 && <p className="px-2 text-xs text-ink-faint">No matches yet.</p>}
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {facetsQuery.data?.companies.map((c) => (
            <CheckboxRow
              key={c.id}
              checked={selectedCompanyIds.includes(c.id)}
              onChange={() => onToggleCompany(c.id)}
              label={c.name}
              count={c.count}
            />
          ))}
        </div>

        <p className="mt-4 mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint">Seniority</p>
        <div className="space-y-0.5">
          {SENIORITY_BUCKETS.map((bucket) => (
            <CheckboxRow
              key={bucket}
              checked={selectedSeniority.includes(bucket)}
              onChange={() => onToggleSeniority(bucket)}
              label={SENIORITY_BUCKET_LABELS[bucket]}
              count={facetsQuery.data?.seniority[bucket]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
