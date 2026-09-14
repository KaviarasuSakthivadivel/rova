import { fetchWithRetry } from "@/lib/retry";
import type { JobSource, NormalizedJob } from "./base";

const BASE_URL = "https://boards-api.greenhouse.io/v1/boards";

/**
 * Greenhouse Job Board API — public, unauthenticated GET.
 * https://developer.greenhouse.io/job-board.html
 */
export class GreenhouseSource implements JobSource {
  readonly source = "greenhouse";

  constructor(
    private readonly boardToken: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async fetchJobs(): Promise<NormalizedJob[]> {
    const url = `${BASE_URL}/${this.boardToken}/jobs?content=true`;

    const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) {
      throw new Error(`Greenhouse fetch failed (${response.status}) for board "${this.boardToken}"`);
    }

    const data = (await response.json()) as { jobs?: unknown[] };
    return (data.jobs ?? []).map((raw) => normalize(raw as GreenhouseJob));
  }
}

export interface RawGreenhouseQuestion {
  label: string;
  description: string | null;
  required: boolean;
  fieldType: string; // "input_text" | "textarea" | "input_file" | "single_select" | ...
}

interface GreenhouseQuestionsResponse {
  questions?: {
    label?: string;
    description?: string | null;
    required?: boolean;
    fields?: { name: string; type: string }[];
  }[];
}

// Greenhouse's per-job "questions" array mixes real custom questions with
// standard identity fields (name/email/phone/resume) that share the same
// input_text/textarea field types. Those aren't things worth an
// AI-drafted narrative answer — skip them by their well-known field names.
// Custom questions use a "question_<id>" name instead.
const STANDARD_FIELD_NAMES = new Set(["first_name", "last_name", "email", "phone", "resume", "resume_text", "cover_letter", "cover_letter_text"]);

/**
 * The per-job endpoint (distinct from fetchJobs' list endpoint above) —
 * an apply-time concern, not a crawl-time one, so it's called directly by
 * src/applications/questions.ts rather than through JobSource.fetchJobs.
 * https://developer.greenhouse.io/job-board.html#get-a-job
 */
export async function fetchGreenhouseQuestions(boardToken: string, externalId: string): Promise<RawGreenhouseQuestion[]> {
  const url = `${BASE_URL}/${boardToken}/jobs/${externalId}?questions=true`;

  const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`Greenhouse questions fetch failed (${response.status}) for job "${externalId}"`);
  }

  const data = (await response.json()) as GreenhouseQuestionsResponse;
  const out: RawGreenhouseQuestion[] = [];

  for (const q of data.questions ?? []) {
    // Only fields an LLM can meaningfully draft prose for — file uploads,
    // selects, and checkboxes have no free-text answer to generate.
    for (const field of q.fields ?? []) {
      if (field.type !== "input_text" && field.type !== "textarea") continue;
      if (STANDARD_FIELD_NAMES.has(field.name)) continue;
      out.push({
        label: q.label ?? field.name,
        description: q.description ?? null,
        required: q.required ?? false,
        fieldType: field.type,
      });
    }
  }

  return out;
}

interface GreenhouseJob {
  id: number | string;
  title: string;
  content?: string;
  absolute_url?: string;
  first_published?: string;
  updated_at?: string;
  location?: { name?: string };
  offices?: { location?: string }[];
}

function normalize(raw: GreenhouseJob): NormalizedJob {
  const location = raw.location?.name ?? raw.offices?.[0]?.location;

  return {
    externalId: String(raw.id),
    title: raw.title,
    description: raw.content ?? "",
    location,
    jobUrl: raw.absolute_url ?? "",
    postedAt: parseDate(raw.first_published),
    sourceUpdatedAt: parseDate(raw.updated_at),
  };
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
