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
    <div className="max-w-2xl">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-faint">Admin</p>
      <h1 className="mt-1 font-display text-4xl font-medium text-ink">Company discovery</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Heuristic URL patterns first, Claude + web search as a fallback. Nothing joins the tracked company list
        without approval here.
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
        className="mt-8 space-y-3 border-b-2 border-rule-strong pb-6"
      >
        <label htmlFor="names" className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Company names (one per line)
        </label>
        <textarea
          id="names"
          rows={4}
          value={namesInput}
          onChange={(e) => setNamesInput(e.target.value)}
          placeholder={"Anthropic\nExample Co"}
          className="w-full border-2 border-ink bg-paper px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-rust focus:outline-none"
        />
        {error && <p className="border-l-2 border-rust bg-rust-tint px-3 py-2 text-sm text-rust-dim">{error}</p>}
        <button
          type="submit"
          disabled={discoverMutation.isPending}
          className="bg-ink px-6 py-2.5 text-sm font-semibold uppercase tracking-wide text-paper transition-colors hover:bg-rust disabled:opacity-50"
        >
          {discoverMutation.isPending ? "Searching…" : "Discover"}
        </button>
      </form>

      <p className="mt-8 font-mono text-xs uppercase tracking-wide text-ink-faint">
        Pending review — {candidatesQuery.data?.candidates.length ?? 0}
      </p>
      <div className="mt-3 space-y-3">
        {candidatesQuery.isLoading && <p className="text-sm text-ink-soft">Loading…</p>}
        {candidatesQuery.data?.candidates.length === 0 && <p className="text-sm text-ink-soft">Nothing pending.</p>}
        {candidatesQuery.data?.candidates.map((candidate) => (
          <article key={candidate.id} className="flex items-start justify-between gap-4 border border-ink p-4">
            <div>
              <p className="font-display text-lg font-medium text-ink">{candidate.name}</p>
              <p className="mt-0.5 font-mono text-xs text-ink-soft">
                {candidate.guessedAts ? `${candidate.guessedAts} / ${candidate.guessedIdentifier}` : "no ATS guess"}
                {candidate.confidence ? ` · confidence ${candidate.confidence}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={approveMutation.isPending || !candidate.guessedAts}
                onClick={() => approveMutation.mutate(candidate.id)}
                className="border border-moss px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-moss transition-colors hover:bg-moss hover:text-paper disabled:opacity-40"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={rejectMutation.isPending}
                onClick={() => rejectMutation.mutate(candidate.id)}
                className="border border-rule-strong px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-soft transition-colors hover:border-rust hover:text-rust-dim disabled:opacity-40"
              >
                Reject
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
