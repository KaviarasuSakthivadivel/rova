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
      <h1 className="text-3xl font-normal text-on-surface">Company discovery</h1>
      <p className="mt-1 text-sm text-on-surface-variant">
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
        className="mt-6 space-y-3 rounded-2xl border border-outline-variant bg-surface-container-lowest p-5"
      >
        <label htmlFor="names" className="text-sm font-medium text-on-surface-variant">
          Company names (one per line)
        </label>
        <textarea
          id="names"
          rows={4}
          value={namesInput}
          onChange={(e) => setNamesInput(e.target.value)}
          placeholder={"Anthropic\nExample Co"}
          className="w-full rounded-xl border border-outline bg-transparent px-4 py-3 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {error && <p className="rounded-xl bg-error-container px-4 py-2.5 text-sm text-on-error-container">{error}</p>}
        <button
          type="submit"
          disabled={discoverMutation.isPending}
          className="state-layer rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-on-primary shadow-sm disabled:opacity-50"
        >
          {discoverMutation.isPending ? "Searching…" : "Discover"}
        </button>
      </form>

      <p className="mt-8 text-xs font-medium uppercase tracking-wide text-on-surface-variant/70">
        Pending review — {candidatesQuery.data?.candidates.length ?? 0}
      </p>
      <div className="mt-3 space-y-3">
        {candidatesQuery.isLoading && <p className="text-sm text-on-surface-variant">Loading…</p>}
        {candidatesQuery.data?.candidates.length === 0 && <p className="text-sm text-on-surface-variant">Nothing pending.</p>}
        {candidatesQuery.data?.candidates.map((candidate) => (
          <article
            key={candidate.id}
            className="flex items-start justify-between gap-4 rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm"
          >
            <div>
              <p className="text-base font-medium text-on-surface">{candidate.name}</p>
              <p className="mt-0.5 font-mono text-xs text-on-surface-variant">
                {candidate.guessedAts ? `${candidate.guessedAts} / ${candidate.guessedIdentifier}` : "no ATS guess"}
                {candidate.confidence ? ` · confidence ${candidate.confidence}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={approveMutation.isPending || !candidate.guessedAts}
                onClick={() => approveMutation.mutate(candidate.id)}
                className="state-layer rounded-full bg-tertiary-container px-4 py-1.5 text-xs font-medium text-on-tertiary-container disabled:opacity-40"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={rejectMutation.isPending}
                onClick={() => rejectMutation.mutate(candidate.id)}
                className="state-layer rounded-full border border-outline px-4 py-1.5 text-xs font-medium text-on-surface-variant disabled:opacity-40"
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
