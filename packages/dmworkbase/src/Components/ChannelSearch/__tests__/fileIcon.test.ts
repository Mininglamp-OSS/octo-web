import { describe, expect, it } from "vitest";
import { channelSearchFileIconTestUtils } from "../fileIcon";

const { extensionForIconLookup } = channelSearchFileIconTestUtils;

describe("channel search file icon lookup extension", () => {
  it("falls back to the visible file name when no backend extension is provided", () => {
    expect(extensionForIconLookup("report.final")).toBe("final");
  });

  it("uses the backend extension when it matches the visible file name", () => {
    expect(extensionForIconLookup("report.pdf", "pdf")).toBe("pdf");
    expect(extensionForIconLookup("REPORT.PDF", "pdf")).toBe("pdf");
  });

  it("cleans the backend extension before lookup", () => {
    expect(extensionForIconLookup("report", " .pdf ")).toBe("pdf");
  });

  it("prefers backend extension when a dotted name segment is not the file type", () => {
    expect(extensionForIconLookup("report.final", "pdf")).toBe("pdf");
  });

  it("prefers backend extension when the visible name conflicts with it", () => {
    expect(extensionForIconLookup("report.doc", "pdf")).toBe("pdf");
  });
});
