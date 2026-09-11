export interface SummarizeJobInput {
  title: string;
  companyName: string;
  description: string | null;
}

export const SUMMARIZE_SYSTEM_PROMPT =
  "Summarize the job posting in exactly one sentence (max 25 words): what the role actually is, plus " +
  "seniority/key skill if stated. No marketing fluff, no company mission statements, no preamble — just the sentence.";

export function summarizeUserPrompt(input: SummarizeJobInput): string {
  return `Title: ${input.title}\nCompany: ${input.companyName}\nDescription: ${(input.description ?? "").slice(0, 2000)}`;
}
