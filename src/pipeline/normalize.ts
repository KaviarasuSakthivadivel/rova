import { createHash } from "node:crypto";
import { decodeHTML } from "entities";
import { convert } from "html-to-text";

export function htmlToText(value: string | undefined | null): string {
  if (!value) return "";

  // Greenhouse (and some other ATS providers) return the `content` field
  // HTML-entity-encoded on top of the markup itself — e.g. the string
  // literally contains "&lt;div&gt;" rather than "<div>". Decode once
  // before handing it to the HTML parser, or the tags never get stripped
  // and show up as literal text in the output.
  const decoded = decodeHTML(value);

  return convert(decoded, { wordwrap: false, selectors: [{ selector: "a", options: { ignoreHref: true } }] })
    .replace(/\s+/g, " ")
    .trim();
}

export function contentHash(title: string, description: string, location: string | undefined): string {
  const value = [title, description, location ?? ""].join("|");
  return createHash("sha256").update(value).digest("hex");
}
