import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CompanyLogo } from "@/web/components/CompanyLogo";
import { api } from "@/web/lib/api";

const AUTOSAVE_DELAY_MS = 800;

const ICON_PATHS = {
  refresh: "M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0 1 14-4.9M20 15a8 8 0 0 1-14 4.9",
  download: "M12 3v12m0 0-4-4m4 4 4-4M5 21h14",
  externalLink: "M14 5h5v5M19 5 10 14M8 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2",
  check: "M5 13l4 4L19 7",
  copy: "M8 8h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm-3-3h11v3M5 5a1 1 0 0 0-1 1v11h1",
};

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-panel-soft px-3 py-1 text-xs font-bold text-ink-muted hover:bg-line"
    >
      {copied ? <Icon path={ICON_PATHS.check} className="h-3.5 w-3.5" /> : <Icon path={ICON_PATHS.copy} className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function PacketDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const queryClient = useQueryClient();

  const packetQuery = useQuery({ queryKey: ["packet", jobId], queryFn: () => api.getPacket(jobId!), enabled: !!jobId });

  const [resumeText, setResumeText] = useState("");
  const [coverLetterText, setCoverLetterText] = useState("");
  const [freeformQuestion, setFreeformQuestion] = useState("");

  // Tracks which generation's content is currently loaded into local
  // state, keyed by the packet's generatedAt timestamp (undefined = not
  // loaded yet). Re-syncing off this — rather than a one-shot "hydrated"
  // flag reset when Regenerate is clicked — matters because the fire-
  // and-forget POST /generate resolves immediately (before the LLM call
  // even starts), and the "poll while generating" effect below refetches
  // the packet every 2s while it's in flight. A one-shot flag re-armed on
  // click gets re-triggered by one of those *mid-generation* polls
  // (still showing the OLD content), then the real completion a few
  // polls later looks like a "local edit" to stale state — and the
  // autosave effect dutifully PATCHes that stale content back over the
  // freshly generated result. Keying off generatedAt sidesteps this
  // entirely: local state only re-syncs when a generation actually
  // *finished*, once, and never mistakes "the server changed" for "the
  // user typed something."
  const syncedGeneratedAt = useRef<string | null | undefined>(undefined);
  const skipNextAutosave = useRef(false);

  useEffect(() => {
    const packet = packetQuery.data?.packet;
    if (!packet) return;
    if (syncedGeneratedAt.current === packet.generatedAt) return;
    syncedGeneratedAt.current = packet.generatedAt;
    skipNextAutosave.current = true;
    setResumeText(packet.tailoredResumeText ?? "");
    setCoverLetterText(packet.coverLetterText ?? "");
  }, [packetQuery.data]);

  const patchMutation = useMutation({
    mutationFn: (data: { tailoredResumeText?: string; coverLetterText?: string }) => api.updatePacket(jobId!, data),
  });

  // Debounced autosave — "Edits save automatically", no explicit Save
  // button. Skips the run right after the sync effect above wrote to
  // local state on our behalf (that's not a user edit).
  useEffect(() => {
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    const timer = setTimeout(() => {
      patchMutation.mutate({ tailoredResumeText: resumeText, coverLetterText: coverLetterText });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [resumeText, coverLetterText]);

  const generateMutation = useMutation({
    mutationFn: (force: boolean) => api.generatePacket(jobId!, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packet", jobId] });
      queryClient.invalidateQueries({ queryKey: ["packets"] });
    },
  });

  const freeformMutation = useMutation({
    mutationFn: (question: string) => api.draftFreeformAnswer(jobId!, question),
    onSuccess: () => {
      setFreeformQuestion("");
      queryClient.invalidateQueries({ queryKey: ["packet", jobId] });
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => api.setPacketStage(jobId!, "applied"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packet", jobId] });
      queryClient.invalidateQueries({ queryKey: ["packets"] });
    },
  });

  // Poll while a (re)generation is in flight.
  useEffect(() => {
    if (packetQuery.data?.packet.generationStatus !== "generating") return;
    const interval = setInterval(() => queryClient.invalidateQueries({ queryKey: ["packet", jobId] }), 2000);
    return () => clearInterval(interval);
  }, [packetQuery.data?.packet.generationStatus, jobId, queryClient]);

  if (packetQuery.isLoading) {
    return <div className="p-8 text-sm text-ink-muted">Loading…</div>;
  }
  if (packetQuery.isError || !packetQuery.data) {
    return <div className="p-8 text-sm text-red">Couldn't load this packet.</div>;
  }

  const { packet, job, companyName, companyDomain, ats } = packetQuery.data;
  const generating = packet.generationStatus === "generating";
  const showFreeformHelper = ats !== "greenhouse" || packet.answers.length === 0;

  return (
    <div className="packet-print-area h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
        <Link to="/pipeline" className="text-xs font-semibold text-ink-faint hover:text-ink-muted print:hidden">
          ← Back to pipeline
        </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <CompanyLogo name={companyName} domain={companyDomain} size="lg" />
          <div>
            <h1 className="text-2xl font-extrabold text-ink">{job.title}</h1>
            <p className="mt-1 text-ink-muted">
              {companyName}
              {job.location ? ` — ${job.location}` : ""}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 print:hidden">
          <button
            type="button"
            disabled={generateMutation.isPending || generating}
            onClick={() => generateMutation.mutate(true)}
            className="flex items-center gap-1.5 rounded-full bg-panel-soft px-4 py-2 text-sm font-bold text-ink hover:bg-line disabled:opacity-50"
          >
            <Icon path={ICON_PATHS.refresh} />
            {generating ? "Generating…" : "Regenerate pack"}
          </button>
          {packet.tailoredResumeText && (
            <a
              href={`/api/applications/${job.id}/resume.pdf`}
              download
              className="flex items-center gap-1.5 rounded-full bg-panel-soft px-4 py-2 text-sm font-bold text-ink hover:bg-line"
            >
              <Icon path={ICON_PATHS.download} />
              Resume PDF
            </a>
          )}
          {packet.coverLetterText && (
            <a
              href={`/api/applications/${job.id}/cover-letter.pdf`}
              download
              className="flex items-center gap-1.5 rounded-full bg-panel-soft px-4 py-2 text-sm font-bold text-ink hover:bg-line"
            >
              <Icon path={ICON_PATHS.download} />
              Cover Letter PDF
            </a>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-panel p-5 print:hidden">
        <a
          href={job.applyUrl ?? job.jobUrl}
          target="_blank"
          rel="noreferrer"
          className="flex w-full items-center justify-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-center text-sm font-bold text-white hover:bg-brand-dark"
        >
          Apply on {companyName}
          <Icon path={ICON_PATHS.externalLink} />
        </a>
        <p className="mt-2 text-center text-xs text-ink-faint">This employer requires you to submit yourself.</p>

        {packet.stage !== "applied" && (
          <button
            type="button"
            disabled={applyMutation.isPending}
            onClick={() => applyMutation.mutate()}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-panel-soft px-4 py-2 text-xs font-bold text-ink-muted hover:bg-line disabled:opacity-50"
          >
            <Icon path={ICON_PATHS.check} className="h-3.5 w-3.5" />
            Mark as applied
          </button>
        )}
      </div>

      {packet.generationStatus === "failed" && (
        <p className="mt-4 rounded-xl bg-red-soft px-4 py-2.5 text-sm text-red">{packet.generationError ?? "Generation failed."}</p>
      )}

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">Resume</p>
          <CopyButton text={resumeText} />
        </div>
        <textarea
          rows={16}
          value={resumeText}
          onChange={(e) => setResumeText(e.target.value)}
          placeholder={generating ? "Generating…" : "No tailored resume yet — generate a pack above."}
          className="mt-2 w-full whitespace-pre-line rounded-xl bg-panel-soft px-3.5 py-3 font-mono text-xs leading-relaxed text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">Cover letter</p>
          <CopyButton text={coverLetterText} />
        </div>
        <textarea
          rows={8}
          value={coverLetterText}
          onChange={(e) => setCoverLetterText(e.target.value)}
          placeholder={generating ? "Generating…" : "No cover letter yet — generate a pack above."}
          className="mt-2 w-full whitespace-pre-line rounded-xl bg-panel-soft px-3.5 py-3 text-sm leading-relaxed text-ink focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <div className="mt-8">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-faint">Application questions</p>

        {packet.answers.length > 0 && (
          <div className="mt-2 space-y-4">
            {packet.answers.map((qa, i) => (
              <div key={`${qa.question}-${i}`} className="rounded-xl bg-panel-soft p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold text-ink">{qa.question}</p>
                  <CopyButton text={qa.answer} />
                </div>
                <p className="mt-1.5 text-sm text-ink-muted">{qa.answer}</p>
              </div>
            ))}
          </div>
        )}

        {showFreeformHelper && (
          <div className="mt-4 rounded-xl bg-panel p-4 print:hidden">
            <p className="text-xs font-semibold text-ink-muted">
              {ats === "greenhouse" ? "Need an answer for another question?" : "Paste a question from the application and get a draft answer."}
            </p>
            <textarea
              rows={2}
              value={freeformQuestion}
              onChange={(e) => setFreeformQuestion(e.target.value)}
              placeholder="e.g. Why are you interested in this role?"
              className="mt-2 w-full rounded-xl bg-panel-soft px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <button
              type="button"
              disabled={freeformMutation.isPending || !freeformQuestion.trim()}
              onClick={() => freeformMutation.mutate(freeformQuestion.trim())}
              className="mt-2 rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              {freeformMutation.isPending ? "Drafting…" : "Draft answer"}
            </button>
            {freeformMutation.isError && <p className="mt-2 text-xs text-red">Couldn't draft an answer — try again.</p>}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
