import { useQuery } from "@tanstack/react-query";
import { PacketCard } from "@/web/components/PacketCard";
import { api } from "@/web/lib/api";
import type { ApplicationPacketSummary, ApplicationStage } from "@/web/lib/types";

const COLUMNS: { stage: ApplicationStage; title: string; blurb: string }[] = [
  { stage: "added", title: "Added", blurb: "Jobs you're watching" },
  { stage: "ready", title: "Ready", blurb: "Custom resume & cover letter prepared" },
  { stage: "applied", title: "Applied", blurb: "Jobs you've applied to" },
];

export function Pipeline() {
  const packetsQuery = useQuery({
    queryKey: ["packets"],
    queryFn: () => api.listPackets(),
    refetchInterval: (query) =>
      query.state.data?.packets.some((p) => p.packet.generationStatus === "generating") ? 2000 : false,
  });

  const packets = packetsQuery.data?.packets ?? [];
  const byStage = (stage: ApplicationStage): ApplicationPacketSummary[] => packets.filter((p) => p.packet.stage === stage);

  return (
    <div className="h-full overflow-y-auto px-6 py-8 sm:px-10">
      <h1 className="text-3xl font-extrabold tracking-tight text-ink">Pipeline</h1>
      <p className="mt-1 text-ink-muted">Generate applications for your favorites, then track where each one stands.</p>

      {packetsQuery.isLoading && <p className="mt-6 text-sm text-ink-muted">Loading…</p>}
      {packetsQuery.data && packets.length === 0 && (
        <p className="mt-6 text-sm text-ink-muted">
          Nothing here yet — open a job from the Jobs page and click "Add to pipeline" to get started.
        </p>
      )}

      {packets.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = byStage(col.stage);
            return (
              <div key={col.stage}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-brand-ink">{col.title}</p>
                  <span className="rounded-full bg-panel-soft px-2 py-0.5 text-xs font-bold text-ink-faint">{items.length}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-faint">{col.blurb}</p>
                <div className="mt-3 space-y-3">
                  {items.map((summary) => (
                    <PacketCard key={summary.packet.id} summary={summary} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
