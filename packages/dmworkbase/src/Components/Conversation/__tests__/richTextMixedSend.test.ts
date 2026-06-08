import { describe, expect, it } from "vitest";
import {
  buildRichTextMixedCandidate,
  isImageFileForRichTextMixed,
} from "../richTextMixedSend";

function file(name: string, type = ""): File {
  return new File(["x"], name, { type });
}

describe("buildRichTextMixedCandidate", () => {
  it("mixes upload-button image attachments with editor text into one RichText payload", () => {
    const candidate = buildRichTextMixedCandidate(
      [{ id: "img1", file: file("a.png", "image/png") }],
      [{ type: "text", text: "@Alice 看一下" }]
    );

    expect(candidate?.topImageIds).toEqual(["img1"]);
    expect(candidate?.blocks).toEqual([
      expect.objectContaining({ id: "img1", type: "image" }),
      { type: "text", text: "@Alice 看一下" },
    ]);
  });

  it("keeps pasted image plus text eligible for RichText", () => {
    const image = file("paste.png", "image/png");
    const candidate = buildRichTextMixedCandidate(
      [],
      [
        { type: "text", text: "看图" },
        { type: "image", id: "p1", file: image },
      ]
    );

    expect(candidate?.topImageIds).toEqual([]);
    expect(candidate?.blocks).toHaveLength(2);
  });

  it("does not aggregate when any non-image top attachment is present", () => {
    const candidate = buildRichTextMixedCandidate(
      [
        { id: "img1", file: file("a.png", "image/png") },
        { id: "pdf1", file: file("a.pdf", "application/pdf") },
      ],
      [{ type: "text", text: "看附件" }]
    );

    expect(candidate).toBeNull();
  });

  it("recognizes image files by extension when MIME is missing", () => {
    expect(isImageFileForRichTextMixed(file("screenshot.webp"))).toBe(true);
    expect(isImageFileForRichTextMixed(file("notes.txt"))).toBe(false);
  });
});
