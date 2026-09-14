import { describe, expect, it } from "bun:test";
import { contentHash, htmlToText, sanitizeDescriptionHtml } from "@/pipeline/normalize";

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

  it("preserves paragraph and list structure instead of collapsing to one line", () => {
    const raw = "<h2>Responsibilities</h2><ul><li>Own the roadmap</li><li>Ship code</li></ul><p>Second paragraph.</p>";
    const out = htmlToText(raw);

    expect(out).toContain("\n");
    expect(out.split("\n").length).toBeGreaterThan(1);
    expect(out).toContain("Own the roadmap");
    expect(out).toContain("Second paragraph.");
  });

  it("collapses runs of blank lines down to at most one", () => {
    const raw = "<p>First</p><br><br><br><br><p>Second</p>";
    const out = htmlToText(raw);
    expect(out).not.toContain("\n\n\n");
  });
});

describe("sanitizeDescriptionHtml", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(sanitizeDescriptionHtml(null)).toBeNull();
    expect(sanitizeDescriptionHtml(undefined)).toBeNull();
    expect(sanitizeDescriptionHtml("")).toBeNull();
  });

  it("keeps allowlisted formatting tags", () => {
    const out = sanitizeDescriptionHtml("<h2>Responsibilities</h2><ul><li>Own the roadmap</li></ul><p><strong>Bold</strong> text.</p>");
    expect(out).toContain("<h2>Responsibilities</h2>");
    expect(out).toContain("<li>Own the roadmap</li>");
    expect(out).toContain("<strong>Bold</strong>");
  });

  it("strips scripts, event handlers, and disallowed tags", () => {
    const out = sanitizeDescriptionHtml('<p onclick="alert(1)">Hi</p><script>alert(1)</script><style>body{}</style><iframe src="x"></iframe>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<style");
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("onclick");
    expect(out).toContain("Hi");
  });

  it("keeps href on links but adds target/rel, and strips javascript: URLs", () => {
    const safe = sanitizeDescriptionHtml('<a href="https://example.com">apply</a>');
    expect(safe).toContain('href="https://example.com"');
    expect(safe).toContain('target="_blank"');
    expect(safe).toContain("rel=");

    const unsafe = sanitizeDescriptionHtml('<a href="javascript:alert(1)">apply</a>');
    expect(unsafe).not.toContain("javascript:");
  });

  it("decodes Greenhouse's entity-double-encoded markup before sanitizing", () => {
    const raw = "&lt;p&gt;&lt;strong&gt;Java &amp;amp; Kafka&lt;/strong&gt;&lt;/p&gt;";
    const out = sanitizeDescriptionHtml(raw);
    expect(out).toBe("<p><strong>Java &amp; Kafka</strong></p>");
  });

  it("drops empty paragraphs left behind after stripping disallowed content", () => {
    const out = sanitizeDescriptionHtml("<p>&nbsp;</p><p>Real content</p>");
    expect(out).not.toContain("<p></p>");
    expect(out).toContain("Real content");
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
