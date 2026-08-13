import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { encodeOctoRichTextClipboardPayload } from "../../../Utils/richTextClipboard";
import {
  decideComposerPaste,
  snapshotComposerClipboard,
} from "../clipboardPipeline";
import { createComposerStarterKit } from "../editorKit";

function clipboardData(values: {
  plain?: string;
  html?: string;
  files?: File[];
}) {
  return {
    getData: (type: string) => {
      if (type === "text/plain") return values.plain ?? "";
      if (type === "text/html") return values.html ?? "";
      return "";
    },
    files: values.files ?? [],
  };
}

describe("composer clipboard pipeline", () => {
  it("blocks a secret before considering rich text or files", () => {
    const file = new File(["image"], "image.png", { type: "image/png" });
    const decision = decideComposerPaste(
      snapshotComposerClipboard(
        clipboardData({
          plain: "sk-ABCDEFGHIJKLMNOP",
          html: '<meta name="octo-rich-text" content="invalid">',
          files: [file],
        }),
      ),
    );

    expect(decision).toEqual({
      kind: "block-secret",
      value: "sk-ABCDEFGHIJKLMNOP",
    });
  });

  it("blocks a secret present only in clipboard HTML", () => {
    const decision = decideComposerPaste(
      snapshotComposerClipboard(
        clipboardData({ html: "<p>sk-ABCDEFGHIJKLMNOP</p>" }),
      ),
    );

    expect(decision).toEqual({
      kind: "block-secret",
      value: "sk-ABCDEFGHIJKLMNOP",
    });
  });

  it("routes Octo rich text before clipboard files", () => {
    const file = new File(["image"], "image.png", { type: "image/png" });
    const payload = encodeOctoRichTextClipboardPayload({
      version: 1,
      blocks: [{ type: "text", text: "hello" }],
    });
    const decision = decideComposerPaste(
      snapshotComposerClipboard(
        clipboardData({
          html: `<div data-octo-richtext="${payload}"></div>`,
          files: [file],
        }),
      ),
    );

    expect(decision.kind).toBe("octo-rich-text");
  });

  it("routes ordinary clipboard files through the attachment path", () => {
    const file = new File(["image"], "image.png", { type: "image/png" });

    expect(
      decideComposerPaste(
        snapshotComposerClipboard(clipboardData({ files: [file] })),
      ),
    ).toEqual({ kind: "files", files: [file] });
  });

  it("reads screenshot files from clipboard items when files is empty", () => {
    const file = new File(["image"], "screenshot.png", {
      type: "image/png",
    });
    const snapshot = snapshotComposerClipboard({
      getData: () => "",
      files: [],
      items: [{ kind: "file", getAsFile: () => file }],
    });

    expect(decideComposerPaste(snapshot)).toEqual({
      kind: "files",
      files: [file],
    });
  });

  it("keeps text ahead of files for mixed clipboard content", () => {
    const file = new File(["image"], "image.png", { type: "image/png" });

    expect(
      decideComposerPaste(
        snapshotComposerClipboard(
          clipboardData({ plain: "caption", files: [file] }),
        ),
      ),
    ).toEqual({ kind: "default" });
  });

  it("leaves ordinary text and external HTML to ProseMirror", () => {
    expect(
      decideComposerPaste(
        snapshotComposerClipboard(
          clipboardData({
            plain: "Example",
            html: '<p><a href="https://example.com/docs">Example</a></p>',
          }),
        ),
      ),
    ).toEqual({ kind: "default" });
  });

  it("preserves explicit HTML links without auto-linking plain .md text", () => {
    const editor = new Editor({ extensions: [createComposerStarterKit()] });
    try {
      editor.commands.setContent(
        '<p><a href="https://example.com/docs">Example</a> README.md</p>',
      );

      const paragraph = editor.getJSON().content?.[0];
      expect(paragraph?.content?.[0]).toMatchObject({
        type: "text",
        text: "Example",
        marks: [
          {
            type: "link",
            attrs: expect.objectContaining({ href: "https://example.com/docs" }),
          },
        ],
      });
      expect(paragraph?.content?.[1]).toEqual({
        type: "text",
        text: " README.md",
      });
    } finally {
      editor.destroy();
    }
  });
});
