import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/web/lib/api";

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
      <h1 className="text-2xl font-semibold text-slate-900">Your profile</h1>
      <p className="mt-1 text-sm text-slate-500">
        Describe your background and upload a resume — both feed the "Match to my profile" search on the Jobs page.
      </p>

      {profileQuery.isLoading ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStatus("idle");
            saveMutation.mutate();
          }}
          className="mt-6 space-y-4"
        >
          <div>
            <label htmlFor="profileText" className="block text-sm font-medium text-slate-700">
              About you
            </label>
            <textarea
              id="profileText"
              required
              rows={6}
              value={profileText}
              onChange={(e) => setProfileText(e.target.value)}
              placeholder="Senior backend engineer. Java, Kafka, AWS, distributed systems. Interested in Staff/Senior roles in the Bay Area or remote US."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="resume" className="block text-sm font-medium text-slate-700">
              Resume
            </label>
            <div className="mt-1 flex items-center gap-3">
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
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">PDF or .txt, up to 5MB.</p>

            {uploadMutation.isPending && <p className="mt-2 text-sm text-slate-500">Reading {resumeFileName}…</p>}

            {(resumeText || resumeFileName) && !uploadMutation.isPending && (
              <div className="mt-2">
                <label htmlFor="resumeText" className="block text-xs font-medium text-slate-500">
                  Extracted text (edit if anything looks off)
                </label>
                <textarea
                  id="resumeText"
                  rows={5}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs text-slate-600 focus:border-slate-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          <div>
            <label htmlFor="locations" className="block text-sm font-medium text-slate-700">
              Preferred locations
            </label>
            <input
              id="locations"
              type="text"
              value={locations}
              onChange={(e) => setLocations(e.target.value)}
              placeholder="San Francisco, New York, Remote"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-400">Comma-separated.</p>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={remoteOk}
              onChange={(e) => setRemoteOk(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Open to fully remote roles
          </label>

          {status === "saved" && <p className="text-sm text-emerald-600">Saved.</p>}
          {status === "saved-no-embedding" && (
            <p className="text-sm text-amber-600">
              Saved — but "Match to my profile" search won't work yet. The server couldn't generate an embedding (no
              embeddings provider configured — OPENAI_API_KEY or a local Ollama).
            </p>
          )}
          {(status === "error" || uploadMutation.isError) && error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={saveMutation.isPending || uploadMutation.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saveMutation.isPending ? "Saving…" : "Save profile"}
          </button>
        </form>
      )}
    </div>
  );
}
