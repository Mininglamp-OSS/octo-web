import { describe, expect, it } from "vitest";
import { getFileViewerFilename } from "../renderers/fileViewerFilename";

describe("getFileViewerFilename", () => {
  it.each([
    ["report.wps", "report.docx"],
    ["budget.et", "budget.xlsx"],
    ["slides.dps", "slides.pptx"],
  ])("maps WPS filename %s to %s", (filename, expected) => {
    expect(getFileViewerFilename(filename)).toBe(expected);
  });

  it.each(["report.docx", "budget.xlsx", "slides.pptx", "README", ".env", "report."]) (
    "keeps non-WPS filename %s unchanged",
    (filename) => {
      expect(getFileViewerFilename(filename)).toBe(filename);
    },
  );

  it("matches extensions case-insensitively", () => {
    expect(getFileViewerFilename("REPORT.WPS")).toBe("REPORT.docx");
  });
});
