import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/web/lib/api";

const fieldLabel = "text-xs font-medium text-fg-muted";
const fieldInput =
  "mt-1 w-full rounded-md border border-border-strong bg-bg px-2.5 py-1.5 text-sm text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

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
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-fg">Your profile</h1>
      <p className="mt-1 text-sm text-fg-muted">Feeds every rank and match on the Jobs page.</p>

      {profileQuery.isLoading ? (
        <p className="mt-6 text-sm text-fg-muted">Loading…</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStatus("idle");
            saveMutation.mutate();
          }}
          className="mt-5 space-y-4 rounded-lg border border-border bg-bg p-5"
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

          <div className="border-t border-border pt-4">
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
                uploadMutation.mutate(file);
              }}
              className="mt-1.5 block w-full text-sm text-fg-muted file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-bg file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-fg hover:file:bg-bg-muted"
            />
            <p className="mt-1 text-xs text-fg-subtle">PDF or .txt, up to 5MB.</p>

            {uploadMutation.isPending && <p className="mt-2 text-sm text-fg-muted">Reading {resumeFileName}…</p>}

            {(resumeText || resumeFileName) && !uploadMutation.isPending && (
              <div className="mt-2">
                <label htmlFor="resumeText" className="text-xs font-medium text-fg-subtle">
                  Extracted text (edit if anything looks off)
                </label>
                <textarea
                  id="resumeText"
                  rows={5}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-bg-subtle px-2.5 py-1.5 font-mono text-xs text-fg-muted focus:border-accent focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="border-t border-border pt-4">
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
            <p className="mt-1 text-xs text-fg-subtle">Comma-separated.</p>

            <label className="mt-3 flex items-center gap-1.5 text-sm text-fg-muted">
              <input type="checkbox" checked={remoteOk} onChange={(e) => setRemoteOk(e.target.checked)} className="h-3.5 w-3.5 accent-accent" />
              Open to fully remote roles
            </label>
          </div>

          {status === "saved" && <p className="rounded-md bg-success-subtle px-3 py-2 text-sm text-success">Saved.</p>}
          {status === "saved-no-embedding" && (
            <p className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger">
              Saved — but "Match to my profile" search won't work yet. The server couldn't generate an embedding (no
              embeddings provider configured — OPENAI_API_KEY or a local Ollama).
            </p>
          )}
          {(status === "error" || uploadMutation.isError) && error && (
            <p className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger">{error}</p>
          )}

          <button
            type="submit"
            disabled={saveMutation.isPending || uploadMutation.isPending}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saveMutation.isPending ? "Saving…" : "Save profile"}
          </button>
        </form>
      )}
    </div>
  );
}
