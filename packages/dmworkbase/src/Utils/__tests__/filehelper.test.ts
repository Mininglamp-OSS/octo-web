import { describe, expect, it } from "vitest";
import FileHelper, { FileType } from "../filehelper";

describe("FileHelper", () => {
  it("extracts extensions case-insensitively and handles extensionless names", () => {
    expect(FileHelper.getFileExt("Report.PDF")).toBe(".pdf");
    expect(FileHelper.getFileExt("README")).toBe("");
    expect(FileHelper.getFileExt("archive.tar.gz")).toBe(".gz");
  });

  it.each([
    ["photo.PNG", FileType.Image],
    ["document.docx", FileType.Word],
    ["sheet.XLSX", FileType.Excel],
    ["slides.ppt", FileType.PPT],
    ["manual.pdf", FileType.PDF],
    ["archive.zip", FileType.ZIP],
    ["archive.rar", FileType.RAR],
  ] as const)("classifies %s", (fileName, expectedType) => {
    expect(FileHelper.getFileType(fileName)).toBe(expectedType);
  });

  it("returns no type for unsupported extensions", () => {
    // Characterize the existing API: FileType.Unkown is declared but the
    // implementation currently returns undefined for unsupported extensions.
    expect(FileHelper.getFileType("data.csv")).toBeUndefined();
    expect(FileHelper.contain(".txt", FileHelper.imgExt)).toBe(false);
  });

  it("formats legacy and modern file sizes at their supported units", () => {
    expect(FileHelper.getFileSizeFormat(512)).toBe("512 B");
    expect(FileHelper.getFileSizeFormat(1024)).toBe("1.00 KB");
    expect(FileHelper.getFileSizeFormat(2048)).toBe("2.00 KB");
    expect(FileHelper.getFileSizeFormat(1024 * 1024)).toBe("1.00 M");
    expect(FileHelper.getFileSizeFormat(2 * 1024 * 1024)).toBe("2.00 M");
    expect(FileHelper.formatFileSize(512)).toBe("512B");
    expect(FileHelper.formatFileSize(1536)).toBe("1.5KB");
    expect(FileHelper.formatFileSize(2 * 1024 * 1024)).toBe("2.0MB");
  });

  it("returns null for an empty icon request", () => {
    expect(FileHelper.getFileIconInfo("")).toBeNull();
  });
});
