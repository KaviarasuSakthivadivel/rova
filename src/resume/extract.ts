import { extractText, getDocumentProxy } from "unpdf";

const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5MB

export class UnsupportedResumeTypeError extends Error {
  constructor(type: string) {
    super(`Unsupported resume file type: ${type || "unknown"}. Upload a PDF or plain text file.`);
  }
}

export class ResumeTooLargeError extends Error {
  constructor() {
    super("Resume file is too large (5MB max).");
  }
}

/**
 * PDF extraction via `unpdf` — a zero-dependency pdf.js wrapper with no
 * native/canvas requirement, so it compiles cleanly into the single
 * executable (verified: `bun build --compile` + a real PDF round-trip).
 */
export async function extractResumeText(file: File): Promise<string> {
  if (file.size > MAX_RESUME_BYTES) throw new ResumeTooLargeError();

  const name = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || name.endsWith(".pdf");
  const isText = file.type.startsWith("text/") || name.endsWith(".txt");

  if (isPdf) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim();
  }

  if (isText) {
    return (await file.text()).trim();
  }

  throw new UnsupportedResumeTypeError(file.type || name);
}
