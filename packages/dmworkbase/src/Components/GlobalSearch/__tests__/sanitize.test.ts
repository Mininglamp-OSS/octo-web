import { describe, expect, it } from "vitest";
import { sanitizeHighlight } from "../sanitize";

describe("sanitizeHighlight", () => {
  it("preserves mark tags while escaping other HTML", () => {
    expect(
      sanitizeHighlight('<mark>Alice</mark><script>alert("x")</script>')
    ).toBe(
      '<mark>Alice</mark>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });

  it("accepts case-insensitive mark tags and escapes quotes and ampersands", () => {
    expect(sanitizeHighlight("<MARK>A & B</MARK> 'quoted'"))
      .toBe("<mark>A &amp; B</mark> &#39;quoted&#39;");
  });

  it("escapes attribute-bearing mark tags instead of treating them as markup", () => {
    expect(sanitizeHighlight('<mark onmouseover="alert(1)">x</mark>')).toBe(
      '&lt;mark onmouseover=&quot;alert(1)&quot;&gt;x</mark>'
    );
  });

  it("preserves nested mark tags as-is", () => {
    expect(sanitizeHighlight("<mark><mark>key</mark></mark>")).toBe(
      "<mark><mark>key</mark></mark>"
    );
  });

  it("returns an empty string unchanged", () => {
    expect(sanitizeHighlight("")).toBe("");
  });
});
