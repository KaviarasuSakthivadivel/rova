import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/web/lib/api";

const fieldLabel = "text-sm font-medium text-on-surface-variant";
const fieldInput =
  "mt-1.5 w-full rounded-xl border border-outline bg-transparent px-4 py-3 text-sm text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

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
      <h1 className="text-3xl font-normal text-on-surface">Your profile</h1>
      <p className="mt-1 text-sm text-on-surface-variant">
        Feeds every rank and match on the Jobs page — the more grounded, the better the "why" behind each result.
      </p>

      {profileQuery.isLoading ? (
        <p className="mt-8 text-sm text-on-surface-variant">Loading…</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStatus("idle");
            saveMutation.mutate();
          }}
          className="mt-6 space-y-5"
        >
          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5">
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

          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5">
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
                className="block w-full text-sm text-on-surface-variant file:mr-3 file:rounded-full file:border-0 file:bg-secondary-container file:px-4 file:py-2 file:text-xs file:font-medium file:text-on-secondary-container"
              />
            </div>
            <p className="mt-1.5 text-xs text-on-surface-variant/70">PDF or .txt, up to 5MB.</p>

            {uploadMutation.isPending && <p className="mt-3 text-sm text-on-surface-variant">Reading {resumeFileName}…</p>}

            {(resumeText || resumeFileName) && !uploadMutation.isPending && (
              <div className="mt-3">
                <label htmlFor="resumeText" className="text-xs font-medium text-on-surface-variant/80">
                  Extracted text (edit if anything looks off)
                </label>
                <textarea
                  id="resumeText"
                  rows={5}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-outline-variant bg-surface-container-low px-3.5 py-2.5 font-mono text-xs text-on-surface-variant focus:border-primary focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-5">
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
            <p className="mt-1.5 text-xs text-on-surface-variant/70">Comma-separated.</p>

            <label className="mt-4 flex items-center gap-2 text-sm font-medium text-on-surface-variant">
              <input type="checkbox" checked={remoteOk} onChange={(e) => setRemoteOk(e.target.checked)} className="h-4 w-4 accent-primary" />
              Open to fully remote roles
            </label>
          </div>

          {status === "saved" && (
            <p className="rounded-xl bg-tertiary-container px-4 py-2.5 text-sm text-on-tertiary-container">Saved.</p>
          )}
          {status === "saved-no-embedding" && (
            <p className="rounded-xl bg-error-container px-4 py-2.5 text-sm text-on-error-container">
              Saved — but "Match to my profile" search won't work yet. The server couldn't generate an embedding (no
              embeddings provider configured — OPENAI_API_KEY or a local Ollama).
            </p>
          )}
          {(status === "error" || uploadMutation.isError) && error && (
            <p className="rounded-xl bg-error-container px-4 py-2.5 text-sm text-on-error-container">{error}</p>
          )}

          <button
            type="submit"
            disabled={saveMutation.isPending || uploadMutation.isPending}
            className="state-layer rounded-full bg-primary px-6 py-3 text-sm font-medium text-on-primary shadow-sm disabled:opacity-50"
          >
            {saveMutation.isPending ? "Saving…" : "Save profile"}
          </button>
        </form>
      )}
    </div>
  );
}
