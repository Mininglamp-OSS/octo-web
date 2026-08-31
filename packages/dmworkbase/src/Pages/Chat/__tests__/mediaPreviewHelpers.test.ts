import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import { extensionFromUrl, fallbackSearchMediaExtension, searchMediaPreviewName } from "../index"

describe("chat search media preview helpers", () => {
  it("extracts extensions without query strings and chooses media fallbacks", () => {
    expect(extensionFromUrl("https://cdn.test/a/photo.PNG?token=1")).toBe("png")
    expect(extensionFromUrl("https://cdn.test/a/no-extension")).toBe("")
    expect(fallbackSearchMediaExtension("video" as any)).toBe("mp4")
    expect(fallbackSearchMediaExtension("image" as any)).toBe("jpg")
  })

  it("builds stable preview names from message ids and sequence numbers", () => {
    expect(searchMediaPreviewName({ kind: "image", messageSeq: 12 } as any, "png")).toBe("image-12.png")
    expect(searchMediaPreviewName({ kind: "video", messageId: "m1" } as any, "mp4")).toBe("video-m1.mp4")
    expect(searchMediaPreviewName({ kind: "image" } as any, "jpg")).toBe("image-preview.jpg")
  })
})
