import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/web/lib/api";

const fieldLabel = "text-xs font-semibold text-ink-muted";
const fieldInput = "mt-1 w-full rounded-xl bg-panel-soft px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand";

export function Profile() {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ["profile"], queryFn: () => api.getProfile() });

  const [profileText, setProfileText] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [resumePreviewUrl, setResumePreviewUrl] = useState<string | null>(null);
  const [resumeIsPdf, setResumeIsPdf] = useState(false);
  const [locations, setLocations] = useState("");
  const [remoteOk, setRemoteOk] = useState(true);
  const [status, setStatus] = useState<"idle" | "saved" | "saved-no-embedding" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const profile = profileQuery.data?.profile;
    if (!profile) return;
    setProfileText(profile.profileText);
    setResumeText(profile.resumeText ?? "");
    setLocations((profile.preferences.locations ?? []).join(", "));
    setRemoteOk(profile.preferences.remoteOk ?? true);
  }, [profileQuery.data]);

  // Preview is derived from the in-memory File, not stored server-side —
  // it only exists for the file just picked in this browser session.
  useEffect(() => {
    return () => {
      if (resumePreviewUrl) URL.revokeObjectURL(resumePreviewUrl);
    };
  }, [resumePreviewUrl]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadResume(file),
    onSuccess: (data) => {
      setResumeText(data.resumeText);
      setStatus("idle");
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Failed to read that file");
      setResumeFileName(null);
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      api.saveProfile({
        profileText,
        resumeText: resumeText || undefined,
        preferences: {
          locations: locations
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean),
          remoteOk,
        },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["profile"], { profile: data.profile });
      setStatus(data.profile.embedding ? "saved" : "saved-no-embedding");
      setError(null);
    },
    onError: (err) => {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Failed to save profile");
    },
  });

  return (
    <div className="h-full max-w-xl overflow-y-auto px-6 py-8 sm:px-10">
      <h1 className="text-3xl font-extrabold tracking-tight text-ink">Your profile</h1>
      <p className="mt-1 text-ink-muted">Feeds every rank and match on the Jobs page.</p>

      {profileQuery.isLoading ? (
        <p className="mt-6 text-sm text-ink-muted">Loading…</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStatus("idle");
            saveMutation.mutate();
          }}
          className="mt-6 space-y-4"
        >
          <div className="rounded-2xl bg-panel p-6 shadow-sm">
            <label htmlFor="profileText" className={fieldLabel}>
              About you
            </label>
            <textarea
              id="profileText"
              required
              rows={6}
              value={profileText}
              onChange={(e) => setProfileText(e.target.value)}
              placeholder="Senior backend engineer. Java, Kafka, AWS, distributed systems. Interested in Staff/Senior roles in the Bay Area or remote US."
              className={fieldInput}
            />
          </div>

          <div className="rounded-2xl bg-panel p-6 shadow-sm">
            <label htmlFor="resume" className={fieldLabel}>
              Resume
            </label>
            <input
              id="resume"
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setResumeFileName(file.name);

                if (resumePreviewUrl) URL.revokeObjectURL(resumePreviewUrl);
                const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
                setResumeIsPdf(isPdf);
                setResumePreviewUrl(isPdf ? URL.createObjectURL(file) : null);

                uploadMutation.mutate(file);
              }}
              className="mt-2 block w-full text-sm text-ink-muted file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-4 file:py-1.5 file:text-xs file:font-bold file:text-brand-ink"
            />
            <p className="mt-1.5 text-xs text-ink-faint">PDF or .txt, up to 5MB.</p>

            {uploadMutation.isPending && <p className="mt-3 text-sm text-ink-muted">Reading {resumeFileName}…</p>}

            {resumeIsPdf && resumePreviewUrl && !uploadMutation.isPending && (
              <iframe
                src={resumePreviewUrl}
                title="Resume preview"
                className="mt-3 h-96 w-full rounded-xl border border-line bg-panel-soft"
              />
            )}

            {(resumeText || resumeFileName) && !uploadMutation.isPending && (
              <details className="mt-3 group">
                <summary className="cursor-pointer text-xs font-medium text-ink-faint select-none group-open:text-ink-muted">
                  Show extracted text (edit if anything looks off)
                </summary>
                <textarea
                  id="resumeText"
                  rows={5}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  className="mt-1.5 w-full rounded-xl bg-panel-soft px-3.5 py-2.5 font-mono text-xs text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand"
                />
              </details>
            )}
          </div>

          <div className="rounded-2xl bg-panel p-6 shadow-sm">
            <label htmlFor="locations" className={fieldLabel}>
              Preferred locations
            </label>
            <input
              id="locations"
              type="text"
              value={locations}
              onChange={(e) => setLocations(e.target.value)}
              placeholder="San Francisco, New York, Remote"
              className={fieldInput}
            />
            <p className="mt-1.5 text-xs text-ink-faint">Comma-separated.</p>

            <label className="mt-4 flex items-center gap-2 text-sm font-medium text-ink-muted">
              <input type="checkbox" checked={remoteOk} onChange={(e) => setRemoteOk(e.target.checked)} className="h-4 w-4 accent-brand" />
              Open to fully remote roles
            </label>
          </div>

          {status === "saved" && <p className="rounded-xl bg-brand-soft px-4 py-2.5 text-sm text-brand-ink">Saved.</p>}
          {status === "saved-no-embedding" && (
            <p className="rounded-xl bg-red-soft px-4 py-2.5 text-sm text-red">
              Saved — but "Match to my profile" search won't work yet. The server couldn't generate an embedding (no
              embeddings provider configured — OPENAI_API_KEY or a local Ollama).
            </p>
          )}
          {(status === "error" || uploadMutation.isError) && error && (
            <p className="rounded-xl bg-red-soft px-4 py-2.5 text-sm text-red">{error}</p>
          )}

          <button
            type="submit"
            disabled={saveMutation.isPending || uploadMutation.isPending}
            className="rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            {saveMutation.isPending ? "Saving…" : "Save profile"}
          </button>
        </form>
      )}
    </div>
  );
}
