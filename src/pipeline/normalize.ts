import { createHash } from "node:crypto";
import { decodeHTML } from "entities";
import { convert } from "html-to-text";
import sanitizeHtml from "sanitize-html";

export function htmlToText(value: string | undefined | null): string {
  if (!value) return "";

  // Greenhouse (and some other ATS providers) return the `content` field
  // HTML-entity-encoded on top of the markup itself — e.g. the string
  // literally contains "&lt;div&gt;" rather than "<div>". Decode once
  // before handing it to the HTML parser, or the tags never get stripped
  // and show up as literal text in the output.
  const decoded = decodeHTML(value);

  return convert(decoded, { wordwrap: false, selectors: [{ selector: "a", options: { ignoreHref: true } }] })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const ALLOWED_DESCRIPTION_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "a",
  "blockquote",
  "hr",
];

// Rendered with dangerouslySetInnerHTML (JobDetail.tsx) — every tag/attr
// not on this allowlist is stripped, so this is the actual XSS boundary,
// not just a formatting nicety. Keep it as tight as job-posting markup
// (headings/lists/emphasis/links) actually needs.
export function sanitizeDescriptionHtml(value: string | undefined | null): string | null {
  if (!value) return null;

  const decoded = decodeHTML(value);
  const clean = sanitizeHtml(decoded, {
    allowedTags: ALLOWED_DESCRIPTION_TAGS,
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
    exclusiveFilter: (frame) => (frame.tag === "p" || frame.tag === "li") && !frame.text.trim(),
  }).trim();

  return clean.length > 0 ? clean : null;
}

export function contentHash(title: string, description: string, location: string | undefined): string {
  const value = [title, description, location ?? ""].join("|");
  return createHash("sha256").update(value).digest("hex");
}
