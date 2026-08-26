import { describe, expect, it } from "vitest";
import { normalizeDownloadSettings, sanitizeDownloadFilename } from "../downloadSettings";

describe("sanitizeDownloadFilename", () => {
  it("keeps filenames inside the download directory", () => {
    expect(sanitizeDownloadFilename("../../etc/passwd", "download")).toBe(".._.._etc_passwd");
    expect(sanitizeDownloadFilename("CON.txt", "download")).toBe("_CON.txt");
    expect(sanitizeDownloadFilename("report.txt. ", "download")).toBe("report.txt");
  });

  it("limits UTF-8 byte length while preserving the extension", () => {
    const filename = sanitizeDownloadFilename(`${"报告".repeat(100)}.pdf`, "download");
    expect(Buffer.byteLength(filename, "utf8")).toBeLessThanOrEqual(240);
    expect(filename.endsWith(".pdf")).toBe(true);
  });
});

describe("normalizeDownloadSettings", () => {
  it("migrates only the legacy default directory", () => {
    expect(normalizeDownloadSettings(
      { directory: "/Users/nancy/Downloads/Shared Files", askBeforeSaving: true },
      "/Users/nancy/Library/Application Support/Octo/Downloads/Shared Files",
      "/Users/nancy/Downloads/Shared Files",
    )).toEqual({ directory: "/Users/nancy/Library/Application Support/Octo/Downloads/Shared Files", askBeforeSaving: true });
  });

  it("preserves a user-selected directory", () => {
    expect(normalizeDownloadSettings(
      { directory: "/tmp/my-files", askBeforeSaving: false },
      "/app/Downloads/Shared Files",
      "/Users/nancy/Downloads/Shared Files",
    )).toEqual({ directory: "/tmp/my-files", askBeforeSaving: false });
  });
});
