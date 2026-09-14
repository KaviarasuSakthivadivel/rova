import { describe, expect, it } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { renderCoverLetterPdf, renderResumePdf } from "@/applications/pdf";

const SAMPLE_RESUME = `Jane Doe
San Francisco, CA | jane@example.com | (555) 012-3456
linkedin.com/in/janedoe

SUMMARY

Backend engineer with five years building distributed systems.

EXPERIENCE

Acme Corp · San Francisco, CA · Jan 2022 – Present
Senior Software Engineer
- Led the migration of the billing service to event-driven architecture.
- Reduced p99 latency by 40% through targeted caching.

SKILLS

Java, Go, PostgreSQL, Kafka, AWS, Docker`;

// PDF content streams are Flate-compressed by pdf-lib with no opt-out, so
// asserting on raw output bytes doesn't actually check what got drawn —
// extract real text the same way src/resume/extract.ts parses an
// uploaded resume, so these assertions can't pass vacuously.
async function textOf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

describe("renderResumePdf", () => {
  it("produces a valid, parseable PDF", async () => {
    const bytes = await renderResumePdf(SAMPLE_RESUME);
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renders the header, section headers, and bullet content as real extractable text", async () => {
    const bytes = await renderResumePdf(SAMPLE_RESUME);
    const text = await textOf(bytes);
    expect(text).toContain("Jane Doe");
    expect(text).toContain("SUMMARY");
    expect(text).toContain("Acme Corp");
    expect(text).toContain("Senior Software Engineer");
    expect(text).toContain("Led the migration of the billing service");
    expect(text).toContain("Java, Go, PostgreSQL");
  });

  it("never prints meta-commentary like 'Tailored for' anywhere in the document", async () => {
    // Regression test: the old design injected a synthetic "Tailored for
    // X at Y" context line — explicitly removed per user feedback, since
    // a real resume shouldn't reference the specific application at all.
    const bytes = await renderResumePdf(SAMPLE_RESUME);
    const text = await textOf(bytes);
    expect(text.toLowerCase()).not.toContain("tailored for");
  });

  it("spans multiple pages for long content instead of clipping it", async () => {
    const longSection = Array.from({ length: 120 }, (_, i) => `- Bullet point number ${i} with enough text to take real vertical space.`).join("\n");
    const bytes = await renderResumePdf(`Jane Doe\n\nEXPERIENCE\n\nAcme Corp · SF · 2020 – Present\nEngineer\n${longSection}`);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it("handles empty-ish content without throwing", async () => {
    const bytes = await renderResumePdf("");
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
  });

  it("bullets an entry's achievement line even when the model omitted the '-' marker", async () => {
    // Regression test: a real generation had 3 of 4 experience entries
    // come back with a single achievement line and no "-" prefix — the
    // old marker-based check rendered those as an unbulleted paragraph
    // instead of a bullet. Bullets are now positional (3rd+ line of an
    // entry), not marker-dependent.
    const resumeText = `Jane Doe\n\nEXPERIENCE\n\nAcme Corp · SF · 2022 – Present\nEngineer\n- Marked bullet, has the dash.\n\nWidgets Inc · NYC · 2020 – 2022\nDeveloper\nUnmarked achievement line, no dash prefix at all.`;
    const bytes = await renderResumePdf(resumeText);
    const text = await textOf(bytes);
    expect((text.match(/•/g) ?? []).length).toBe(2);
    expect(text).toContain("• Unmarked achievement line, no dash prefix at all.");
  });

  it("bolds a PROJECTS entry's bare name line (no 'Org · Location · Date' shape)", async () => {
    const resumeText = `Jane Doe\n\nPROJECTS\n\nTwitter Search Engine\nDjango, Elasticsearch\n- Built an end-to-end search app.`;
    const bytes = await renderResumePdf(resumeText);
    const text = await textOf(bytes);
    expect(text).toContain("Twitter Search Engine");
    expect(text).toContain("Django, Elasticsearch");
    expect(text).toContain("• Built an end-to-end search app.");
  });

  it("bullets an entry's lines even when the model inserts a stray blank line before its first bullet", async () => {
    // Regression test: a real generation put a blank line between an
    // entry's subtitle and its first achievement line (before any bullet
    // marker appeared). The old unconditional "blank line always starts a
    // fresh entry" reset misread that stray blank as an entry boundary,
    // rendering the next line bold (as a bare header) and the one after
    // it italic (as a subtitle) instead of bulleting both — only the
    // *real* bullets after them rendered correctly.
    const resumeText = `Jane Doe\n\nEXPERIENCE\n\nAcme Corp · SF · 2022 – Present\nEngineer\n\nIntro line with no dash, right after a stray blank line.\nSecond intro line, also no dash.\n- Led a real migration project.\n- Reduced latency significantly.`;
    const bytes = await renderResumePdf(resumeText);
    const text = await textOf(bytes);
    expect((text.match(/•/g) ?? []).length).toBe(4);
    expect(text).toContain("• Intro line with no dash, right after a stray blank line.");
    expect(text).toContain("• Second intro line, also no dash.");
  });

  it("still starts a fresh entry on a blank line once the previous entry has a real bullet", async () => {
    // Companion to the above: the fix must not stop treating blank lines
    // as entry separators in the common case — only suppress the reset
    // for a stray blank that lands *before* an entry's first bullet.
    const resumeText = `Jane Doe\n\nEXPERIENCE\n\nAcme Corp · SF · 2022 – Present\nEngineer\n- Did the first thing.\n\nWidgets Inc · NYC · 2020 – 2022\nDeveloper\n- Did the second thing.`;
    const bytes = await renderResumePdf(resumeText);
    const text = await textOf(bytes);
    expect(text).toContain("Widgets Inc");
    expect(text).not.toContain("• Widgets Inc");
    expect((text.match(/•/g) ?? []).length).toBe(2);
  });

  it("does not bullet flowing sections like SUMMARY or SKILLS", async () => {
    const resumeText = `Jane Doe\n\nSUMMARY\n\nA line of prose.\nAnother line of prose.\n\nSKILLS\n\nJava, Go`;
    const bytes = await renderResumePdf(resumeText);
    const text = await textOf(bytes);
    expect(text).not.toContain("•");
  });

  it("renders a header paragraph in full (wrapped, not clipped) when the model skips the SUMMARY header", async () => {
    // Regression test: a real generation merged the contact+links lines
    // and omitted the SUMMARY header entirely, running straight into its
    // opening paragraph. The old unbounded "everything before the first
    // section header is centered header text" loop rendered that whole
    // paragraph centered and *unwrapped* — for a paragraph much wider
    // than the page, that draws starting left of the margin and running
    // off the right edge, silently clipped by the page canvas (visually:
    // the text appeared to start mid-word and cut off part way through).
    const longParagraph =
      "Backend engineer with extensive experience building distributed systems in Java and Spring Boot with React and Ember front ends, workflow automation across many applications, and production on-call ownership end to end.";
    const resumeText = `Jane Doe\nSF, CA • jane@example.com • (555) 012-3456 • linkedin.com/in/jane\n${longParagraph}\n\nEXPERIENCE\n\nAcme Corp · SF · 2022 – Present\nEngineer\n- Did a thing.`;

    const bytes = await renderResumePdf(resumeText);
    // Wrapping inserts its own line breaks, so compare with whitespace
    // collapsed rather than asserting on an exact contiguous substring.
    const text = (await textOf(bytes)).replace(/\s+/g, " ");
    expect(text).toContain(longParagraph.slice(0, 40)); // the opening isn't missing/clipped
    expect(text).toContain(longParagraph.slice(-40)); // neither is the tail
    expect(text).toContain("EXPERIENCE");
  });
});

describe("renderCoverLetterPdf", () => {
  it("renders the actual cover letter prose as extractable text, with no synthetic header", async () => {
    const bytes = await renderCoverLetterPdf("Dear hiring team,\n\nI'm excited to apply.\n\nSincerely,\nJane");
    const text = await textOf(bytes);
    expect(text).toContain("Dear hiring team");
    expect(text).toContain("Sincerely");
    expect(text).not.toContain("Re:");
  });
});
