import { describe, expect, it } from "bun:test";
import { extractResumeText, ResumeTooLargeError, UnsupportedResumeTypeError } from "@/resume/extract";

// Minimal hand-built single-page PDF containing one text run — enough to
// exercise the real pdf.js-backed extraction path without a binary fixture.
// /Length is computed from the actual stream bytes so recovery-mode
// parsing (no xref table here) doesn't silently truncate the text.
function buildMinimalPdf(text: string): string {
  const stream = `BT\n  /F1 18 Tf\n  0 0 Td\n  (${text}) Tj\nET`;
  return `%PDF-1.1
%\xA5\xB1\xEB

1 0 obj
  << /Type /Catalog
     /Pages 2 0 R
  >>
endobj

2 0 obj
  << /Type /Pages
     /Kids [3 0 R]
     /Count 1
     /MediaBox [0 0 300 144]
  >>
endobj

3 0 obj
  <<  /Type /Page
      /Parent 2 0 R
      /Resources
       << /Font
           << /F1
               << /Type /Font
                  /Subtype /Type1
                  /BaseFont /Times-Roman
               >>
           >>
       >>
      /Contents 4 0 R
  >>
endobj

4 0 obj
  << /Length ${stream.length} >>
stream
${stream}
endstream
endobj

trailer
  <<  /Root 1 0 R
      /Size 5
  >>
%%EOF
`;
}

const MINIMAL_PDF = buildMinimalPdf("Jane Doe Senior Backend Engineer Java Kafka AWS");

function fileFrom(name: string, content: BlobPart, type: string): File {
  return new File([content], name, { type });
}

describe("extractResumeText", () => {
  it("extracts text from a .txt file", async () => {
    const file = fileFrom("resume.txt", "Backend engineer. Java, Kafka, AWS.", "text/plain");
    expect(await extractResumeText(file)).toBe("Backend engineer. Java, Kafka, AWS.");
  });

  it("extracts text from a real PDF", async () => {
    // This hand-built fixture has no xref table, so pdf.js falls back to
    // its recovery parser and can truncate the content stream slightly —
    // the point of this test is that real PDF bytes go in and real
    // extracted text comes out, not exact fixture fidelity.
    const file = fileFrom("resume.pdf", MINIMAL_PDF, "application/pdf");
    const text = await extractResumeText(file);
    expect(text).toContain("Jane Doe");
    expect(text.length).toBeGreaterThan(10);
  });

  it("falls back to file extension when the MIME type is missing", async () => {
    const file = fileFrom("resume.txt", "Some resume text.", "");
    expect(await extractResumeText(file)).toBe("Some resume text.");
  });

  it("rejects unsupported file types", async () => {
    const file = fileFrom("resume.docx", "binary garbage", "application/vnd.openxmlformats");
    await expect(extractResumeText(file)).rejects.toBeInstanceOf(UnsupportedResumeTypeError);
  });

  it("rejects files over the size limit", async () => {
    const bigContent = new Uint8Array(5 * 1024 * 1024 + 1);
    const file = fileFrom("resume.txt", bigContent, "text/plain");
    await expect(extractResumeText(file)).rejects.toBeInstanceOf(ResumeTooLargeError);
  });
});
