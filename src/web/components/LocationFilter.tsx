import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/web/lib/api";

interface ScopeParams {
  q?: string;
  semantic?: boolean;
  postedWithinDays?: number;
  companyIds?: string[];
  seniority?: string[];
}

// A typeahead, not a plain text box — suggestions are real distinct
// location strings pulled live from the data (see GET /api/jobs/locations),
// scoped to whatever else is currently filtered, not a hardcoded list
// that drifts from what jobs actually have.
export function LocationFilter({
  value,
  onChange,
  onSelect,
  scopeParams,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fired on suggestion click — a decisive pick, so the caller runs the
   * search immediately rather than waiting on the Search button. */
  onSelect: (value: string) => void;
  scopeParams: ScopeParams;
}) {
  const [open, setOpen] = useState(false);
  const [debouncedValue, setDebouncedValue] = useState(value);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), 250);
    return () => clearTimeout(timer);
  }, [value]);

  const suggestionsQuery = useQuery({
    queryKey: [
      "location-suggestions",
      debouncedValue,
      scopeParams.q,
      scopeParams.semantic,
      scopeParams.postedWithinDays,
      scopeParams.companyIds,
      scopeParams.seniority,
    ],
    queryFn: () => api.getLocationSuggestions({ search: debouncedValue || undefined, ...scopeParams }),
    enabled: open,
  });

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const suggestions = suggestionsQuery.data?.locations ?? [];

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        placeholder="Location"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="w-36 rounded-full bg-panel-soft px-4 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute top-full left-0 z-30 mt-1.5 max-h-64 w-64 overflow-y-auto rounded-xl border border-line bg-panel p-1.5 shadow-xl">
          {suggestions.map((s) => (
            <button
              key={s.location}
              type="button"
              onClick={() => {
                onSelect(s.location);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink hover:bg-panel-soft"
            >
              <span className="min-w-0 truncate">{s.location}</span>
              <span className="shrink-0 text-xs text-ink-faint">{s.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
