import { describe, it, expect, vi } from "vitest";

vi.mock("../renderers/FileViewerRenderer", () => ({ default: () => null }));

import fileRendererRegistry from "../registry";

describe("FileRendererRegistry", () => {
  it("routes supported formats to the unified file-viewer renderer", () => {
    for (const ext of [
      "pdf", "doc", "docx", "dot", "dotx", "rtf", "odt",
      "xls", "xlsx", "xlsm", "xlsb", "xltx", "ods", "csv",
      "pptx", "potx", "ppsx", "odp", "epub", "md", "txt", "png",
    ]) {
      expect(fileRendererRegistry.canPreview(ext)).toBe(true);
      expect(fileRendererRegistry.getRenderer(ext).renderer).toBeDefined();
    }
  });

  it("normalizes uppercase extensions", () => {
    expect(fileRendererRegistry.canPreview("DOCX")).toBe(true);
    expect(fileRendererRegistry.canPreview("PPTX")).toBe(true);
    expect(fileRendererRegistry.canPreview("XLSX")).toBe(true);
  });

  it("keeps unsupported legacy PowerPoint unsupported", () => {
    expect(fileRendererRegistry.canPreview("ppt")).toBe(false);
  });

  it("uses the unified renderer for unknown files", () => {
    const item = fileRendererRegistry.getRenderer("unknown-format");
    expect(item.type).toBe("unknown");
    expect(item.renderer).toBeDefined();
  });
});
