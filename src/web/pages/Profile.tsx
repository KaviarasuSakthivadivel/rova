import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/web/lib/api";

const fieldLabel = "text-xs font-semibold uppercase tracking-wide text-ink-soft";
const fieldInput =
  "mt-1.5 w-full border-2 border-ink bg-paper px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-rust focus:outline-none";

export function Profile() {
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ["profile"], queryFn: () => api.getProfile() });

  const [profileText, setProfileText] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
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
    <div className="max-w-2xl">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-faint">02 — Your profile</p>
      <h1 className="mt-1 font-display text-4xl font-medium text-ink">What you bring</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Feeds every rank and match on the Jobs page — the more grounded, the better the "why" behind each result.
      </p>

      {profileQuery.isLoading ? (
        <p className="mt-8 text-sm text-ink-soft">Loading…</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStatus("idle");
            saveMutation.mutate();
          }}
          className="mt-8 space-y-6"
        >
          <div>
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

          <div className="border-t border-rule pt-6">
            <label htmlFor="resume" className={fieldLabel}>
              Resume
            </label>
            <div className="mt-2">
              <input
                id="resume"
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setResumeFileName(file.name);
                  uploadMutation.mutate(file);
                }}
                className="block w-full text-sm text-ink-soft file:mr-3 file:border-2 file:border-ink file:bg-paper file:px-3 file:py-1.5 file:text-xs file:font-semibold file:uppercase file:tracking-wide file:text-ink hover:file:bg-ink hover:file:text-paper"
              />
            </div>
            <p className="mt-1.5 font-mono text-xs text-ink-faint">PDF or .txt, up to 5MB.</p>

            {uploadMutation.isPending && <p className="mt-3 text-sm text-ink-soft">Reading {resumeFileName}…</p>}

            {(resumeText || resumeFileName) && !uploadMutation.isPending && (
              <div className="mt-3">
                <label htmlFor="resumeText" className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                  Extracted text (edit if anything looks off)
                </label>
                <textarea
                  id="resumeText"
                  rows={5}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  className="mt-1.5 w-full border border-rule bg-paper-dim px-3 py-2 font-mono text-xs text-ink-soft focus:border-rust focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="border-t border-rule pt-6">
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
            <p className="mt-1.5 font-mono text-xs text-ink-faint">Comma-separated.</p>

            <label className="mt-4 flex items-center gap-2 text-sm font-medium text-ink-soft">
              <input
                type="checkbox"
                checked={remoteOk}
                onChange={(e) => setRemoteOk(e.target.checked)}
                className="h-4 w-4 accent-rust"
              />
              Open to fully remote roles
            </label>
          </div>

          {status === "saved" && (
            <p className="border-l-2 border-moss bg-moss-tint px-3 py-2 text-sm text-moss">Saved.</p>
          )}
          {status === "saved-no-embedding" && (
            <p className="border-l-2 border-rust bg-rust-tint px-3 py-2 text-sm text-rust-dim">
              Saved — but "Match to my profile" search won't work yet. The server couldn't generate an embedding (no
              embeddings provider configured — OPENAI_API_KEY or a local Ollama).
            </p>
          )}
          {(status === "error" || uploadMutation.isError) && error && (
            <p className="border-l-2 border-rust bg-rust-tint px-3 py-2 text-sm text-rust-dim">{error}</p>
          )}

          <button
            type="submit"
            disabled={saveMutation.isPending || uploadMutation.isPending}
            className="bg-ink px-6 py-3 text-sm font-semibold uppercase tracking-wide text-paper transition-colors hover:bg-rust disabled:opacity-50"
          >
            {saveMutation.isPending ? "Saving…" : "Save profile"}
          </button>
        </form>
      )}
    </div>
  );
}
