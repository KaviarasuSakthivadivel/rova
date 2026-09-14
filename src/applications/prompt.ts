import type { ApplicationQuestion } from "./questions";

export interface GenerateResumeInput {
  profileText: string;
  resumeText: string | null;
  jobTitle: string;
  companyName: string;
  location: string | null;
  description: string | null;
}

export interface ResumeAndCoverLetter {
  tailoredResumeText: string;
  coverLetterText: string;
}

export interface GenerateResumeResult {
  result: ResumeAndCoverLetter | null; // null on refusal / unparseable / wrong-shape response
  inputTokens: number;
  outputTokens: number;
}

// Hand-written, not derived from a Zod schema — see ranking/claude.ts's
// comment: zodOutputFormat() needs Zod v4 internals and this project is
// pinned to Zod v3 for @hono/zod-validator compatibility. Shared between
// the Claude and Ollama backends — both accept a JSON Schema for
// structured output (Anthropic via output_config.format, Ollama via its
// own `format` request field), so one schema drives both.
export const RESUME_JSON_SCHEMA = {
  type: "object",
  properties: {
    tailoredResumeText: { type: "string" },
    coverLetterText: { type: "string" },
  },
  required: ["tailoredResumeText", "coverLetterText"],
  additionalProperties: false,
} as const;

export const RESUME_SYSTEM_PROMPT = `You write a tailored resume and a short cover letter for one candidate applying to one specific job.

Ground every claim strictly in the candidate's actual profile/resume text below — never invent employers, titles, dates, degrees, or skills that aren't present there. Emphasize the experience most relevant to this job; it's fine, and expected, to leave out experience that isn't relevant.

Never mention this specific application, the job posting, or the word "tailored" anywhere in the resume or cover letter text — it must read exactly like a normal resume/cover letter a candidate would write themselves, with zero meta-commentary about why or for whom it was produced.

The resume must be plain text following this EXACT structure (no markdown, no tables — it's rendered as a real formatted document by a parser that depends on this structure):

Line 1: the candidate's full name, alone on its line.
Line 2: location, email, phone — separated by " | ".
Line 3 (optional): links (LinkedIn, GitHub, portfolio, etc.) — separated by " | ".
A blank line, then each section in turn:
- A section header alone on its line, in CAPS (e.g. "SUMMARY", "EXPERIENCE", "SKILLS", "EDUCATION", "PROJECTS").
- Under EXPERIENCE/EDUCATION: each entry starts with a line "Organization · Location · Date range" (using the exact " · " separator, an actual middle-dot character), then a line with just the title/degree, then "-" bullet points.
- Under PROJECTS: each entry starts with the project name alone on its line, then a line with just the tech stack, then "-" bullet points.
- Under SKILLS: a single flowing comma-separated line, not bulleted.
- Under SUMMARY: one flowing paragraph, not bulleted.
Blank line between every entry and between sections.

Example shape (content is illustrative only, ground the real output in the candidate's actual data):
Jane Doe
San Francisco, CA | jane@example.com | (555) 012-3456
linkedin.com/in/janedoe | github.com/janedoe

SUMMARY

Backend engineer with five years building distributed systems and APIs for high-traffic platforms.

EXPERIENCE

Acme Corp · San Francisco, CA · Jan 2022 – Present
Senior Software Engineer
- Led the migration of the billing service to a new event-driven architecture.
- Reduced p99 latency by 40% through targeted caching.

SKILLS

Java, Go, PostgreSQL, Kafka, AWS, Docker

The cover letter should be 100-150 words, specific to this role and company, no generic filler like "I am excited to apply" — plain prose paragraphs, no header, no "Re:" line, no meta-commentary about the letter itself.`;

export function resumeUserPrompt(input: GenerateResumeInput): string {
  return `Candidate profile:\n${input.profileText}\n\nCandidate resume:\n${input.resumeText ?? "(none provided — use the profile above)"}\n\nJob posting:\nTitle: ${input.jobTitle}\nCompany: ${input.companyName}\nLocation: ${input.location ?? "unspecified"}\nDescription: ${input.description ?? "(no description)"}`;
}

export function isResumeAndCoverLetter(value: unknown): value is ResumeAndCoverLetter {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.tailoredResumeText === "string" && typeof v.coverLetterText === "string";
}

// Floors well below any real resume/cover letter (a real one is easily
// 10x+ this) — only catches the degenerate case seen live under Ollama
// load: a syntactically valid JSON response whose generation got cut off
// right after the candidate's name, passing the shape check above while
// containing essentially nothing. Same failure family as the truncated-
// JSON case the caller already retries on, just past the point where
// JSON.parse itself would fail.
const MIN_RESUME_LENGTH = 200;
const MIN_COVER_LETTER_LENGTH = 150;

export function isImplausiblyShort(result: ResumeAndCoverLetter): boolean {
  return result.tailoredResumeText.length < MIN_RESUME_LENGTH || result.coverLetterText.length < MIN_COVER_LETTER_LENGTH;
}

export interface GenerateAnswersInput {
  profileText: string;
  resumeText: string | null;
  jobTitle: string;
  companyName: string;
  questions: ApplicationQuestion[];
}

export interface GenerateAnswersResult {
  result: { answer: string }[] | null; // one per input question, same order; null on refusal/unparseable/wrong-shape
  inputTokens: number;
  outputTokens: number;
}

export const ANSWERS_JSON_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
    },
  },
  required: ["answers"],
  additionalProperties: false,
} as const;

export const ANSWERS_SYSTEM_PROMPT = `You draft grounded, concise answers to a job application's questions, using only the candidate's actual profile/resume content below — be specific and honest, don't pad with generic enthusiasm.

Answer every question in the same order it's given, exactly one answer per question.`;

export function answersUserPrompt(input: GenerateAnswersInput): string {
  const questionsBlock = input.questions
    .map((q, i) => `${i + 1}. ${q.label}${q.description ? ` (${q.description})` : ""}${q.required ? " [required]" : ""}`)
    .join("\n");

  return `Candidate profile:\n${input.profileText}\n\nCandidate resume:\n${input.resumeText ?? "(none provided — use the profile above)"}\n\nApplying for: ${input.jobTitle} at ${input.companyName}\n\nQuestions:\n${questionsBlock}`;
}

export function isAnswersShape(value: unknown): value is { answers: { answer: string }[] } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.answers) && v.answers.every((a) => typeof a === "object" && a !== null && typeof (a as { answer?: unknown }).answer === "string");
}
