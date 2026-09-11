import { describe, expect, it } from "bun:test";
import { contentHash, htmlToText } from "@/pipeline/normalize";

describe("htmlToText", () => {
  it("strips ordinary HTML", () => {
    const out = htmlToText("<div><h2>About</h2><p>Requires Java &amp; Kafka.</p></div>");
    expect(out).not.toContain("<");
    expect(out.toLowerCase()).toContain("about");
    expect(out).toContain("Requires Java & Kafka.");
  });

  it("handles entity-double-encoded content (Greenhouse's `content` field quirk)", () => {
    // Regression test: Greenhouse returns markup whose tags are themselves
    // HTML-entity-encoded, e.g. "&lt;div&gt;" instead of "<div>". Without
    // decoding first, the tags leak into stored descriptions as literal text.
    const raw = "&lt;div class=&quot;x&quot;&gt;&lt;p&gt;Java &amp;amp; Kafka&lt;/p&gt;&lt;/div&gt;";
    const out = htmlToText(raw);

    expect(out).not.toContain("<div");
    expect(out).not.toContain("&lt;");
    expect(out).toBe("Java & Kafka");
  });

  it("returns an empty string for null/undefined/empty input", () => {
    expect(htmlToText(null)).toBe("");
    expect(htmlToText(undefined)).toBe("");
    expect(htmlToText("")).toBe("");
  });
});

describe("contentHash", () => {
  it("is stable for identical input", () => {
    const a = contentHash("Title", "Description", "Remote");
    const b = contentHash("Title", "Description", "Remote");
    expect(a).toBe(b);
  });

  it("changes when any field changes", () => {
    const base = contentHash("Title", "Description", "Remote");
    expect(contentHash("Title 2", "Description", "Remote")).not.toBe(base);
    expect(contentHash("Title", "Description 2", "Remote")).not.toBe(base);
    expect(contentHash("Title", "Description", "Onsite")).not.toBe(base);
  });

  it("treats undefined location the same as empty string", () => {
    expect(contentHash("Title", "Description", undefined)).toBe(contentHash("Title", "Description", ""));
  });
});
