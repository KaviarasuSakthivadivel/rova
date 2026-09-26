import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CompanyLogo } from "@/web/components/CompanyLogo";
import { api } from "@/web/lib/api";
import type { ApplicationPacketSummary } from "@/web/lib/types";

export function PacketCard({ summary }: { summary: ApplicationPacketSummary }) {
  const { packet, jobTitle, jobLocation, companyName, companyDomain, jobStatus } = summary;
  const isClosed = jobStatus !== "OPEN";
  const queryClient = useQueryClient();

  const generateMutation = useMutation({
    mutationFn: () => api.generatePacket(packet.jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["packets"] }),
  });

  const applyMutation = useMutation({
    mutationFn: () => api.setPacketStage(packet.jobId, "applied"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["packets"] }),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.removeFromPipeline(packet.jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["packets"] }),
  });

  return (
    <div className="rounded-2xl bg-panel p-4 shadow-sm">
      <div className="flex items-start gap-2.5">
        <div className={`flex min-w-0 flex-1 items-start gap-2.5 ${isClosed ? "opacity-50" : ""}`}>
          <CompanyLogo name={companyName} domain={companyDomain} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 truncate text-sm font-bold text-ink">
              <span className="truncate">{jobTitle}</span>
              {isClosed && (
                <span className="shrink-0 rounded-full bg-panel-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-faint">
                  Closed
                </span>
              )}
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              {companyName}
              {jobLocation ? ` · ${jobLocation}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          title="Remove from pipeline"
          disabled={removeMutation.isPending}
          onClick={() => {
            const hasContent = packet.generationStatus === "succeeded";
            if (hasContent && !window.confirm("Remove this from your pipeline? The generated resume, cover letter, and answers will be deleted.")) return;
            removeMutation.mutate();
          }}
          className="shrink-0 text-ink-faint hover:text-red disabled:opacity-40"
        >
          ✕
        </button>
      </div>

      <div className="mt-3">
        {isClosed ? (
          <div className="space-y-1.5">
            <p className="rounded-full bg-panel-soft px-3 py-1.5 text-center text-xs font-semibold text-ink-faint">This posting has closed</p>
            {(packet.stage === "ready" || packet.stage === "applied") && (
              <Link
                to={`/pipeline/${packet.jobId}`}
                className="block w-full rounded-md bg-panel-soft px-3 py-1.5 text-center text-xs font-bold text-ink-muted hover:bg-line"
              >
                Review Pack
              </Link>
            )}
          </div>
        ) : (
          <>
        {packet.stage === "added" && packet.generationStatus !== "generating" && packet.generationStatus !== "failed" && (
          <button
            type="button"
            disabled={generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
            className="w-full rounded-md bg-brand px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            Generate Pack…
          </button>
        )}

        {packet.generationStatus === "generating" && (
          <div className="flex items-center justify-center gap-1.5 rounded-full bg-panel-soft px-3 py-1.5 text-xs font-semibold text-ink-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-ink" />
            Generating…
          </div>
        )}

        {packet.stage === "added" && packet.generationStatus === "failed" && (
          <div className="space-y-1.5">
            <p className="truncate text-xs text-red" title={packet.generationError ?? undefined}>
              {packet.generationError ?? "Generation failed."}
            </p>
            <button
              type="button"
              disabled={generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
              className="w-full rounded-md bg-panel-soft px-3 py-1.5 text-xs font-bold text-ink hover:bg-line disabled:opacity-50"
            >
              Retry
            </button>
          </div>
        )}

        {packet.stage === "ready" && (
          <div className="flex gap-2">
            <Link
              to={`/pipeline/${packet.jobId}`}
              className="flex-1 rounded-md bg-panel-soft px-3 py-1.5 text-center text-xs font-bold text-ink hover:bg-line"
            >
              Review Pack
            </Link>
            <button
              type="button"
              disabled={applyMutation.isPending}
              onClick={() => applyMutation.mutate()}
              className="flex-1 rounded-md bg-brand px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              Mark Applied
            </button>
          </div>
        )}

        {packet.stage === "applied" && (
          <Link
            to={`/pipeline/${packet.jobId}`}
            className="block w-full rounded-md bg-panel-soft px-3 py-1.5 text-center text-xs font-bold text-ink-muted hover:bg-line"
          >
            Review Pack
          </Link>
        )}
          </>
        )}
      </div>
    </div>
  );
}
