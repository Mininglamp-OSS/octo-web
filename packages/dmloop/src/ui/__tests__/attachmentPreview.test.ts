import { describe, it, expect } from "vitest";
import { canPreviewInline } from "../attachmentPreview";

describe("canPreviewInline", () => {
  it("allows known-safe raster formats", () => {
    for (const t of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
    ]) {
      expect(canPreviewInline(t)).toBe(true);
    }
  });

  // Security guarantee: an inline SVG blob would run in the document origin and
  // bypass the backend's attachment disposition + CSP → stored XSS. SVG must
  // always take the download path, never render as an inline <img>/blob.
  it("never inlines SVG", () => {
    expect(canPreviewInline("image/svg+xml")).toBe(false);
    expect(canPreviewInline("IMAGE/SVG+XML")).toBe(false);
    expect(canPreviewInline("image/svg+xml; charset=utf-8")).toBe(false);
    expect(canPreviewInline("  image/svg+xml  ")).toBe(false);
  });

  it("does not inline unknown or non-image types", () => {
    for (const t of [
      "image/bmp",
      "image/tiff",
      "image/x-icon",
      "text/html",
      "application/pdf",
      "application/octet-stream",
      "",
    ]) {
      expect(canPreviewInline(t)).toBe(false);
    }
  });

  it("handles null / undefined without throwing", () => {
    expect(canPreviewInline(null)).toBe(false);
    expect(canPreviewInline(undefined)).toBe(false);
  });

  it("normalizes case and mime parameters", () => {
    expect(canPreviewInline("IMAGE/PNG")).toBe(true);
    expect(canPreviewInline("image/jpeg; charset=binary")).toBe(true);
    expect(canPreviewInline(" image/webp ")).toBe(true);
  });
});
