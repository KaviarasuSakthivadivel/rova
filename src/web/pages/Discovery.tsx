import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "@/web/lib/api";

export function Discovery() {
  const queryClient = useQueryClient();
  const [namesInput, setNamesInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const candidatesQuery = useQuery({
    queryKey: ["discovery-candidates"],
    queryFn: () => api.getDiscoveryCandidates(),
  });

  const discoverMutation = useMutation({
    mutationFn: (names: string[]) => api.discoverCompanies(names),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["discovery-candidates"] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Discovery failed"),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.approveDiscoveryCandidate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["discovery-candidates"] }),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => api.rejectDiscoveryCandidate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["discovery-candidates"] }),
  });

  return (
    <div className="h-full max-w-xl overflow-y-auto px-6 py-8 sm:px-10">
      <h1 className="text-3xl font-extrabold tracking-tight text-ink">Company discovery</h1>
      <p className="mt-1 text-ink-muted">
        Heuristics first, Claude + web search as a fallback. Nothing joins the tracked list without approval here.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const names = namesInput
            .split("\n")
            .map((n) => n.trim())
            .filter(Boolean);
          if (names.length === 0) return;
          discoverMutation.mutate(names);
        }}
        className="mt-6 space-y-3 rounded-2xl bg-panel p-6 shadow-sm"
      >
        <label htmlFor="names" className="text-xs font-semibold text-ink-muted">
          Company names (one per line)
        </label>
        <textarea
          id="names"
          rows={4}
          value={namesInput}
          onChange={(e) => setNamesInput(e.target.value)}
          placeholder={"Anthropic\nExample Co"}
          className="w-full rounded-xl bg-panel-soft px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        />
        {error && <p className="rounded-xl bg-red-soft px-3.5 py-2.5 text-sm text-red">{error}</p>}
        <button
          type="submit"
          disabled={discoverMutation.isPending}
          className="rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {discoverMutation.isPending ? "Searching…" : "Discover"}
        </button>
      </form>

      <p className="mt-8 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Pending review — {candidatesQuery.data?.candidates.length ?? 0}
      </p>
      <div className="mt-2 rounded-2xl bg-panel px-6 shadow-sm">
        {candidatesQuery.isLoading && <p className="py-5 text-sm text-ink-muted">Loading…</p>}
        {candidatesQuery.data?.candidates.length === 0 && <p className="py-5 text-sm text-ink-muted">Nothing pending.</p>}
        {candidatesQuery.data?.candidates.map((candidate, i) => (
          <div
            key={candidate.id}
            className={`flex items-center justify-between gap-4 py-4 ${i > 0 ? "border-t border-line" : ""}`}
          >
            <div>
              <p className="text-sm font-bold text-ink">{candidate.name}</p>
              <p className="mt-0.5 font-mono text-xs text-ink-muted">
                {candidate.guessedAts ? `${candidate.guessedAts} / ${candidate.guessedIdentifier}` : "no ATS guess"}
                {candidate.confidence ? ` · confidence ${candidate.confidence}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-4">
              <button
                type="button"
                disabled={approveMutation.isPending || !candidate.guessedAts}
                onClick={() => approveMutation.mutate(candidate.id)}
                className="text-xs font-bold text-brand disabled:opacity-40"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={rejectMutation.isPending}
                onClick={() => rejectMutation.mutate(candidate.id)}
                className="text-xs font-bold text-ink-faint hover:text-ink disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
