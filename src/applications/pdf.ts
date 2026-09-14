import { type PDFFont, PDFDocument, type PDFPage, rgb, StandardFonts } from "pdf-lib";

// US Letter, matching the market these resumes are written for (the
// generation prompt already writes addresses/phone formats accordingly).
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54; // 0.75in
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.11, 0.11, 0.13);
const MUTED = rgb(0.42, 0.42, 0.46);
const ACCENT = rgb(0.14, 0.31, 0.75); // section-header blue, a standard resume-builder accent

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

interface Cursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
}

function newPage(doc: PDFDocument): PDFPage {
  return doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
}

function ensureSpace(cursor: Cursor, needed: number): void {
  if (cursor.y - needed < MARGIN) {
    cursor.page = newPage(cursor.doc);
    cursor.y = PAGE_HEIGHT - MARGIN;
  }
}

/** Greedy word-wrap using the font's actual glyph widths — pdf-lib has no
 * built-in wrapping, unlike a browser's text layout. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawParagraph(cursor: Cursor, text: string, font: PDFFont, size: number, lineHeight: number, color = INK, indent = 0): void {
  const lines = wrapText(text, font, size, CONTENT_WIDTH - indent);
  for (const line of lines) {
    ensureSpace(cursor, lineHeight);
    cursor.page.drawText(line, { x: MARGIN + indent, y: cursor.y, size, font, color });
    cursor.y -= lineHeight;
  }
}

// Wraps first, then centers each wrapped line individually — a bare
// drawText with a manually-computed x offset works for a short header
// line, but for anything wider than the page (seen live: a model that
// skipped the SUMMARY header ran its opening paragraph into what this
// renderer treats as header content) it draws starting left of the
// margin and runs off the right edge, silently clipped by the page
// canvas rather than erroring — this is the fix for that failure mode,
// not just a cosmetic wrap.
function drawCentered(cursor: Cursor, text: string, font: PDFFont, size: number, lineHeight: number, color = INK): void {
  for (const line of wrapText(text, font, size, CONTENT_WIDTH)) {
    ensureSpace(cursor, lineHeight);
    const width = font.widthOfTextAtSize(line, size);
    cursor.page.drawText(line, { x: MARGIN + (CONTENT_WIDTH - width) / 2, y: cursor.y, size, font, color });
    cursor.y -= lineHeight;
  }
}

function drawDivider(cursor: Cursor): void {
  cursor.page.drawLine({
    start: { x: MARGIN, y: cursor.y },
    end: { x: PAGE_WIDTH - MARGIN, y: cursor.y },
    thickness: 0.75,
    color: rgb(0.85, 0.85, 0.87),
  });
}

// A line the prompt asks the model for as a section header: short,
// letters-only-when-stripped-of-punctuation, and fully uppercase. Mirrors
// RESUME_SYSTEM_PROMPT's convention exactly — see src/applications/prompt.ts.
function isSectionHeader(line: string): boolean {
  const letters = line.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2 || line.length > 40) return false;
  return letters === letters.toUpperCase() && !line.trim().startsWith("-");
}

// "Organization · Location · Date range" — the exact separator the prompt
// is told to use for experience/education entry headers.
function isEntryHeader(line: string): boolean {
  return line.includes(" · ") && !line.trim().startsWith("-");
}

function drawEntryHeader(cursor: Cursor, line: string, fonts: Fonts): void {
  const sepIndex = line.indexOf(" · ");
  const org = line.slice(0, sepIndex);
  const rest = line.slice(sepIndex);
  const size = 10.5;

  ensureSpace(cursor, 14);
  cursor.page.drawText(org, { x: MARGIN, y: cursor.y, size, font: fonts.bold, color: INK });
  const orgWidth = fonts.bold.widthOfTextAtSize(org, size);
  cursor.page.drawText(rest, { x: MARGIN + orgWidth, y: cursor.y, size, font: fonts.regular, color: MUTED });
  cursor.y -= 14;
}

/**
 * Parses the plain-text convention RESUME_SYSTEM_PROMPT asks the model to
 * follow (name/contact header, CAPS section headers, "Org · Location ·
 * Date" entry headers, an italic subtitle line right after one, "-"
 * bullets, flowing paragraphs) and lays it out to match a real
 * resume-builder template rather than rendering it as one undifferentiated
 * block of preformatted text.
 */
export async function renderResumePdf(resumeText: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Resume");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };

  const cursor: Cursor = { doc, page: newPage(doc), y: PAGE_HEIGHT - MARGIN };
  const lines = resumeText.split(/\n/).map((l) => l.trim());

  // Header block: name, then up to 2 contact/links lines, all centered —
  // capped at 3 non-blank lines on purpose, not "every line up to the
  // first section header". A real generation skipped the SUMMARY header
  // entirely and ran straight into its opening paragraph; an unbounded
  // loop here rendered that whole paragraph as centered, unwrapped header
  // text. Capping means the worst case for a missing header is now "this
  // paragraph loses its section label," not "the document is corrupted."
  const MAX_HEADER_LINES = 3;
  let i = 0;
  let headerLineIndex = 0;
  while (i < lines.length && lines[i] !== undefined && headerLineIndex < MAX_HEADER_LINES && !isSectionHeader(lines[i] ?? "")) {
    const line = lines[i] ?? "";
    if (line) {
      if (headerLineIndex === 0) {
        drawCentered(cursor, line, fonts.bold, 19, 26, INK);
      } else {
        drawCentered(cursor, line, fonts.regular, 9.5, 14, MUTED);
      }
      headerLineIndex += 1;
    }
    i += 1;
  }
  cursor.y -= 8;

  // Sections that are genuinely flowing prose, not a list of dated
  // entries — everything else (EXPERIENCE, EDUCATION, PROJECTS, and any
  // other section the model invents, e.g. CERTIFICATIONS) is treated as
  // entry-structured: header/name line, then a subtitle line, then
  // bullets, positionally.
  const FLOWING_SECTIONS = new Set(["SUMMARY", "OBJECTIVE", "PROFILE", "SKILLS"]);

  let inFlowingSection = false;
  let entryLineIndex = 0; // 0 = expecting a header/name line, 1 = subtitle, 2+ = bullets
  let entryHasBullet = false; // has the in-progress entry drawn a real bullet yet?
  let previousWasBlank = true; // suppress a leading gap before the first section
  const bulletIndent = 13;

  function drawBullet(text: string): void {
    ensureSpace(cursor, 13.5);
    cursor.page.drawText("•", { x: MARGIN, y: cursor.y, size: 10, font: fonts.regular, color: INK });
    drawParagraph(cursor, text, fonts.regular, 10, 13.5, INK, bulletIndent);
    entryHasBullet = true;
  }

  // The next non-blank line after `from`, used to tell a real entry
  // boundary apart from a spurious blank line mid-entry (see below).
  function nextNonBlankLine(from: number): string {
    for (let j = from; j < lines.length; j++) {
      const l = lines[j];
      if (l) return l;
    }
    return "";
  }

  for (; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (!line) {
      if (!previousWasBlank) cursor.y -= 8; // entry/paragraph spacing — collapses consecutive blank lines into one gap
      previousWasBlank = true;
      // A blank line *usually* separates entries, but a real generation
      // sometimes drops a stray blank between an entry's subtitle and its
      // first achievement line (before any bullet has been drawn) — with
      // an unconditional reset here, that stray blank re-triggers the
      // header(bold)/subtitle(italic) classification for what are actually
      // the entry's own bullet lines. Only treat the blank as a real
      // boundary once this entry has already produced a bullet, or the
      // next line clearly starts a new one (entry-header shape, or a new
      // section header).
      if (!inFlowingSection && entryLineIndex >= 1) {
        const next = nextNonBlankLine(i + 1);
        if (entryHasBullet || isEntryHeader(next) || isSectionHeader(next)) {
          entryLineIndex = 0;
          entryHasBullet = false;
        }
      }
      continue;
    }
    previousWasBlank = false;

    if (isSectionHeader(line)) {
      ensureSpace(cursor, 30);
      cursor.y -= 10; // breathing room above a new section
      drawParagraph(cursor, line, fonts.bold, 11, 14, ACCENT);
      cursor.y -= 3;
      drawDivider(cursor);
      cursor.y -= 10;
      inFlowingSection = FLOWING_SECTIONS.has(line.toUpperCase());
      entryLineIndex = 0;
      entryHasBullet = false;
      continue;
    }

    if (inFlowingSection) {
      drawParagraph(cursor, line, fonts.regular, 10, 14.5, INK);
      continue;
    }

    // Entry-structured section (EXPERIENCE/EDUCATION/PROJECTS/etc). Bullet
    // markers are NOT required from the model here — positional: the 3rd+
    // non-blank line of an entry is always rendered as a bullet, whether
    // or not it actually starts with "-". Real generations sometimes drop
    // the "-" for a single-achievement entry; the alternative (trusting
    // the marker) silently rendered those as an unbulleted paragraph.
    if (entryLineIndex === 0) {
      if (isEntryHeader(line)) {
        drawEntryHeader(cursor, line, fonts);
      } else {
        // A bare header line (e.g. a PROJECTS entry's name, which has no
        // "Org · Location · Date" shape) — bold, like the org name above.
        drawParagraph(cursor, line, fonts.bold, 10.5, 14, INK);
      }
      entryLineIndex = 1;
      continue;
    }

    if (entryLineIndex === 1) {
      drawParagraph(cursor, line.replace(/^-\s*/, ""), fonts.italic, 10, 14, MUTED);
      entryLineIndex = 2;
      continue;
    }

    drawBullet(line.replace(/^-\s*/, ""));
  }

  return doc.save();
}

export async function renderCoverLetterPdf(coverLetterText: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Cover Letter");
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const cursor: Cursor = { doc, page: newPage(doc), y: PAGE_HEIGHT - MARGIN };

  // Prose only, per RESUME_SYSTEM_PROMPT — no header, no meta-commentary.
  const paragraphs = coverLetterText.split(/\n+/).map((l) => l.trim());
  for (const line of paragraphs) {
    if (!line) continue;
    drawParagraph(cursor, line, regular, 11, 15.5);
    cursor.y -= 10;
  }

  return doc.save();
}
