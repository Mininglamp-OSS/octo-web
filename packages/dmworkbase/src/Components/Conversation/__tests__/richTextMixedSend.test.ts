import { describe, expect, it, vi } from "vitest";
import {
  buildRichTextMixedCandidate,
  countSendPlanParts,
  finishRichTextMixedSend,
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

  it("reports a partial send when a top non-image sent before rich mixed failed", () => {
    const onMessageSent = vi.fn();
    const result = finishRichTextMixedSend(
      true,
      false,
      ["pdf1"],
      onMessageSent
    );

    expect(onMessageSent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ editorConsumed: false, consumedTopIds: ["pdf1"] });
  });

  it("keeps top attachments and later editor blocks as separate guarded parts", () => {
    const topFiles = [{ id: "pdf1", file: file("a.pdf", "application/pdf") }];
    const editorBlocks = [{ type: "text" as const, text: "later text" }];

    expect(countSendPlanParts(topFiles, editorBlocks, "later text", null)).toBe(
      2
    );
  });

  it("counts an aggregated rich-text compose as one guarded part", () => {
    const topFiles = [{ id: "img1", file: file("a.png", "image/png") }];
    const editorBlocks = [{ type: "text" as const, text: "caption" }];
    const candidate = buildRichTextMixedCandidate(topFiles, editorBlocks);

    expect(
      countSendPlanParts(topFiles, editorBlocks, "caption", candidate)
    ).toBe(1);
  });

  it("includes the reply bubble when attachments have no text block", () => {
    const topFiles = [{ id: "pdf1", file: file("a.pdf", "application/pdf") }];

    expect(countSendPlanParts(topFiles, [], "", null, true)).toBe(2);
  });
});
