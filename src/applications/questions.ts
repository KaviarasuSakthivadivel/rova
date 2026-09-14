import { fetchGreenhouseQuestions } from "@/sources/greenhouse";

export interface ApplicationQuestion {
  label: string;
  description: string | null;
  required: boolean;
}

interface QuestionSourceCompany {
  ats: string;
  atsIdentifier: string;
}

interface QuestionSourceJob {
  externalId: string;
}

/**
 * ATS-aware dispatcher, called at packet-generation time (not crawl
 * time — this is an apply-time concern, kept decoupled from the daily
 * crawl same as every other pipeline stage in this codebase).
 *
 * Only Greenhouse's public API exposes per-posting custom application
 * questions (confirmed live — boards-api.greenhouse.io's per-job
 * ?questions=true endpoint). Lever's and Ashby's public unauthenticated
 * APIs have no equivalent, so those return []; the Answers tab falls
 * back to the freeform "paste a question, get a draft" helper for them.
 */
export async function fetchApplicationQuestions(
  company: QuestionSourceCompany,
  job: QuestionSourceJob,
): Promise<ApplicationQuestion[]> {
  if (company.ats !== "greenhouse") return [];

  try {
    const raw = await fetchGreenhouseQuestions(company.atsIdentifier, job.externalId);
    return raw.map((q) => ({ label: q.label, description: q.description, required: q.required }));
  } catch (error) {
    // A broken question fetch must not fail the whole packet generation —
    // it just means this job's Answers tab falls back to the freeform
    // helper, same "one stage's failure doesn't block another" discipline
    // as crawl/enrich/digest.
    console.warn(`[applications] failed to fetch application questions for job ${job.externalId}:`, error);
    return [];
  }
}
