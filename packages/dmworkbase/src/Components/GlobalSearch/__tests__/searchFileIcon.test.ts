import { describe, expect, it } from "vitest";
import {
  docIconSrc,
  driveDocIconSrc,
  driveIconSrc,
  extOf,
  fileIconSrc,
} from "../searchFileIcon";

// SVG assets are inlined as data: URIs by the bundler, so tests assert the
// resolution *relationships* (which extensions share a glyph, which are
// distinct, and what the fallback is) rather than fragile URL strings.

// fileIconSrc("noext") has no extension → the default.svg fallback. Used as the
// reference for "did this resolve to default?".
const DEFAULT_SRC = fileIconSrc("noext");

describe("extOf", () => {
  it("lower-cases and returns the extension after the last dot", () => {
    expect(extOf("Report.PDF")).toBe("pdf");
    expect(extOf("archive.tar.gz")).toBe("gz");
  });

  it("returns '' when there is no extension", () => {
    expect(extOf("README")).toBe("");
    expect(extOf("noext")).toBe("");
  });

  it("returns '' for a trailing dot", () => {
    expect(extOf("weird.")).toBe("");
  });
});

describe("fileIconSrc (extension dispatch)", () => {
  it("shares one glyph across the extensions of a family", () => {
    expect(fileIconSrc("a.doc")).toBe(fileIconSrc("b.docx"));
    expect(fileIconSrc("a.xls")).toBe(fileIconSrc("b.xlsx"));
    expect(fileIconSrc("a.ppt")).toBe(fileIconSrc("b.pptx"));
    expect(fileIconSrc("a.zip")).toBe(fileIconSrc("b.rar"));
    expect(fileIconSrc("a.zip")).toBe(fileIconSrc("b.7z"));
    expect(fileIconSrc("a.mp4")).toBe(fileIconSrc("b.mkv"));
    expect(fileIconSrc("a.mp3")).toBe(fileIconSrc("b.flac"));
    expect(fileIconSrc("a.png")).toBe(fileIconSrc("b.webp"));
    expect(fileIconSrc("a.png")).toBe(fileIconSrc("b.svg"));
    expect(fileIconSrc("a.js")).toBe(fileIconSrc("b.py"));
  });

  it("gives each file family a distinct, non-default glyph", () => {
    // 13 families whose glyphs the legacy dmworkbase pack ships as first-class
    // assets. Code-file extensions (.py / .js / .ts / …) intentionally fall
    // through to default.svg here — the legacy pack has no `code.svg` — so
    // they're covered by the fallback test below rather than this distinctness
    // check.
    const families = [
      "a.pdf",
      "a.doc",
      "a.xlsx",
      "a.pptx",
      "a.csv",
      "a.zip",
      "a.mp4",
      "a.mp3",
      "a.gif",
      "a.png",
      "a.html",
      "a.md",
      "a.txt",
    ].map(fileIconSrc);
    // 13 families, all distinct from each other.
    expect(new Set(families).size).toBe(13);
    // None of them is the default fallback.
    for (const src of families) expect(src).not.toBe(DEFAULT_SRC);
  });

  it("falls back to default.svg for unknown or missing extensions", () => {
    expect(fileIconSrc("a.xyz")).toBe(DEFAULT_SRC);
    expect(fileIconSrc("noext")).toBe(DEFAULT_SRC);
    expect(fileIconSrc("weird.")).toBe(DEFAULT_SRC);
  });
});

describe("driveIconSrc (drive tab)", () => {
  it("uses a stable folder glyph regardless of name", () => {
    // The legacy dmworkbase pack has no dedicated folder.svg, so folders
    // deliberately share the default fallback — the invariant we care about
    // here is stability across names, not distinctness from the default.
    expect(driveIconSrc("folder", "whatever")).toBe(
      driveIconSrc("folder", "another")
    );
    expect(driveIconSrc("folder", "whatever")).toBe(DEFAULT_SRC);
  });

  it("uses the online-doc glyph for doc hits, ignoring the name extension", () => {
    expect(driveIconSrc("doc", "spec.pdf")).toBe(docIconSrc("doc"));
    // doc type wins over the name's .pdf extension.
    expect(driveIconSrc("doc", "spec.pdf")).not.toBe(fileIconSrc("spec.pdf"));
  });

  it("dispatches blobs by extension, same as fileIconSrc", () => {
    expect(driveIconSrc("blob", "a.pdf")).toBe(fileIconSrc("a.pdf"));
    expect(driveIconSrc("blob", "a.xyz")).toBe(DEFAULT_SRC);
  });

  it("dispatches doc hits by doc_type when provided", () => {
    expect(driveIconSrc("doc", "spec.pdf", "sheet")).toBe(
      driveDocIconSrc("sheet")
    );
    expect(driveIconSrc("doc", "spec.pdf", "board")).toBe(
      driveDocIconSrc("board")
    );
    // no doc_type → generic doc fallback, and the name's .pdf never wins.
    expect(driveIconSrc("doc", "spec.pdf")).toBe(driveDocIconSrc(undefined));
    expect(driveIconSrc("doc", "spec.pdf")).not.toBe(fileIconSrc("spec.pdf"));
  });
});

describe("driveDocIconSrc (drive tab doc_type dispatch)", () => {
  it("maps each online-doc sub-type to its glyph", () => {
    // doc == .docx, sheet == .xlsx (在线表格), html == .html, html_ppt == .pptx.
    expect(driveDocIconSrc("doc")).toBe(fileIconSrc("a.docx"));
    expect(driveDocIconSrc("sheet")).toBe(fileIconSrc("a.xlsx"));
    expect(driveDocIconSrc("board")).toBe(docIconSrc("board"));
    expect(driveDocIconSrc("html")).toBe(fileIconSrc("a.html"));
    expect(driveDocIconSrc("html_ppt")).toBe(fileIconSrc("a.pptx"));
  });

  it("falls back to the doc glyph for unknown or missing doc_type", () => {
    const docFallback = fileIconSrc("a.docx");
    expect(driveDocIconSrc(undefined)).toBe(docFallback);
    expect(driveDocIconSrc("")).toBe(docFallback);
    expect(driveDocIconSrc("mystery")).toBe(docFallback);
  });

  it("keeps sheet / board / html_ppt distinct from the doc fallback", () => {
    const docFallback = driveDocIconSrc(undefined);
    expect(driveDocIconSrc("sheet")).not.toBe(docFallback);
    expect(driveDocIconSrc("board")).not.toBe(docFallback);
    expect(driveDocIconSrc("html_ppt")).not.toBe(docFallback);
  });
});

describe("docIconSrc (docs tab)", () => {
  it("gives each cloud-doc kind a distinct glyph", () => {
    const srcs = [
      docIconSrc("doc"),
      docIconSrc("sheet"),
      docIconSrc("board"),
      docIconSrc("html"),
    ];
    expect(new Set(srcs).size).toBe(4);
  });

  it("maps html to the same glyph a .html file uses", () => {
    expect(docIconSrc("html")).toBe(fileIconSrc("page.html"));
  });

  it("uses a doc glyph distinct from the default fallback", () => {
    expect(docIconSrc("doc")).not.toBe(DEFAULT_SRC);
  });

  it("falls back to default.svg for unknown / out-of-enum kinds", () => {
    // A stale front-end shipped against an older DocSearchDocType enum must
    // never render a blank icon slot when the backend introduces a new kind.
    expect(docIconSrc("unknown_kind" as never)).toBe(DEFAULT_SRC);
    expect(docIconSrc("" as never)).toBe(DEFAULT_SRC);
    expect(docIconSrc(undefined as never)).toBe(DEFAULT_SRC);
  });

  it("resists prototype-chain keys", () => {
    // hasOwnProperty gate — a wire value like `__proto__` / `toString` must
    // NOT accidentally resolve to `Object.prototype[key]`.
    expect(docIconSrc("__proto__" as never)).toBe(DEFAULT_SRC);
    expect(docIconSrc("toString" as never)).toBe(DEFAULT_SRC);
  });
});

describe("defensive value handling (boundary crashes)", () => {
  // Regression guard for the P1 crash: the drive-search service boundary
  // validates only `file_id` and `space_id` (see SearchService.searchDrive),
  // so a row with a nullish / non-string `name` can reach render. The old
  // `driveIconSrc` reached `extOf(name).lastIndexOf` on that value and
  // threw a TypeError during render, tripping the ErrorBoundary and
  // replacing the entire GlobalSearch surface with the error fallback.

  it("extOf tolerates nullish and non-string input", () => {
    expect(extOf(undefined)).toBe("");
    expect(extOf(null)).toBe("");
    expect(extOf("")).toBe("");
    expect(extOf("noext")).toBe("");
    expect(extOf("trailing.")).toBe("");
  });

  it("fileIconSrc returns default.svg on nullish name (no throw)", () => {
    expect(fileIconSrc(undefined)).toBe(DEFAULT_SRC);
    expect(fileIconSrc(null)).toBe(DEFAULT_SRC);
    expect(fileIconSrc("")).toBe(DEFAULT_SRC);
  });

  it("driveIconSrc renders a blob hit with nullish name without throwing", () => {
    // The exact production path DriveSearchPanel.renderFileIcon takes when
    // a malformed row slips past the service-boundary filter.
    expect(() => driveIconSrc("blob", undefined)).not.toThrow();
    expect(() => driveIconSrc("blob", null)).not.toThrow();
    expect(driveIconSrc("blob", undefined)).toBe(DEFAULT_SRC);
    expect(driveIconSrc("blob", null)).toBe(DEFAULT_SRC);
  });

  it("driveDocIconSrc resists prototype-chain keys and unknown docType", () => {
    expect(driveDocIconSrc("__proto__")).toBe(driveDocIconSrc(undefined));
    expect(driveDocIconSrc("toString")).toBe(driveDocIconSrc(undefined));
    expect(driveDocIconSrc("nonsense")).toBe(driveDocIconSrc(undefined));
  });

  it("fileIconSrc resists prototype-chain extensions", () => {
    // `file.__proto__` would compute extOf → "__proto__", which used to hit
    // Object.prototype.__proto__ instead of falling through to default.svg.
    expect(fileIconSrc("weird.__proto__")).toBe(DEFAULT_SRC);
    expect(fileIconSrc("weird.toString")).toBe(DEFAULT_SRC);
  });
});
