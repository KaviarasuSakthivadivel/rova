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
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-fg">Company discovery</h1>
      <p className="mt-1 text-sm text-fg-muted">
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
        className="mt-4 space-y-2.5 rounded-lg border border-border bg-bg p-4"
      >
        <label htmlFor="names" className="text-xs font-medium text-fg-muted">
          Company names (one per line)
        </label>
        <textarea
          id="names"
          rows={4}
          value={namesInput}
          onChange={(e) => setNamesInput(e.target.value)}
          placeholder={"Anthropic\nExample Co"}
          className="w-full rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {error && <p className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={discoverMutation.isPending}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {discoverMutation.isPending ? "Searching…" : "Discover"}
        </button>
      </form>

      <p className="mt-6 text-xs font-medium text-fg-subtle">Pending review — {candidatesQuery.data?.candidates.length ?? 0}</p>
      <div className="mt-2 space-y-2">
        {candidatesQuery.isLoading && <p className="text-sm text-fg-muted">Loading…</p>}
        {candidatesQuery.data?.candidates.length === 0 && <p className="text-sm text-fg-muted">Nothing pending.</p>}
        {candidatesQuery.data?.candidates.map((candidate) => (
          <article key={candidate.id} className="flex items-start justify-between gap-4 rounded-lg border border-border bg-bg p-3.5">
            <div>
              <p className="text-sm font-semibold text-fg">{candidate.name}</p>
              <p className="mt-0.5 font-mono text-xs text-fg-muted">
                {candidate.guessedAts ? `${candidate.guessedAts} / ${candidate.guessedIdentifier}` : "no ATS guess"}
                {candidate.confidence ? ` · confidence ${candidate.confidence}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                disabled={approveMutation.isPending || !candidate.guessedAts}
                onClick={() => approveMutation.mutate(candidate.id)}
                className="rounded-md bg-success-subtle px-2.5 py-1 text-xs font-medium text-success disabled:opacity-40"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={rejectMutation.isPending}
                onClick={() => rejectMutation.mutate(candidate.id)}
                className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted disabled:opacity-40"
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
