// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

vi.mock("wukongimjssdk", () => ({
  MessageContent: class {
    contentObj: any;
    contentType!: number;
  },
}));

vi.mock("../../../Service/Const", () => ({
  MessageContentTypeConst: { richText: 14 },
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../App", () => ({
  default: {
    dataSource: {
      commonDataSource: {
        getImageURL: (url: string) => url,
      },
    },
  },
}));

import {
  buildInlineContentForRichTextPaste,
  restoreOctoRichTextClipboardToEditor,
} from "../richTextPaste";

function fakeEditor() {
  const insertContent = vi.fn(() => ({ run: vi.fn() }));
  return {
    insertContent,
    editor: {
      chain: () => ({
        focus: () => ({
          insertContent,
        }),
      }),
    },
  };
}

describe("richTextPaste", () => {
  it("builds inline content with mention nodes and hard breaks", () => {
    expect(
      buildInlineContentForRichTextPaste("hi @Alice\nnext", [
        { uid: "alice", offset: 3, length: "@Alice".length },
      ])
    ).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", attrs: { id: "alice", label: "Alice" } },
      { type: "hardBreak" },
      { type: "text", text: "next" },
    ]);
  });

  it("restores text and image blocks through the existing pasted attachment path", async () => {
    const { editor, insertContent } = fakeEditor();
    const imageFile = new File(["image"], "a.png", { type: "image/png" });
    const addAttachment = vi.fn().mockResolvedValue(undefined);

    await restoreOctoRichTextClipboardToEditor(
      {
        version: 1,
        blocks: [
          { type: "text", text: "before" },
          { type: "image", url: "https://cdn.example.com/a.png" },
          { type: "text", text: "after" },
        ],
      },
      editor,
      addAttachment,
      {
        imageBlockToFile: vi.fn().mockResolvedValue(imageFile),
      }
    );

    expect(insertContent).toHaveBeenNthCalledWith(1, [
      { type: "text", text: "before" },
    ]);
    expect(addAttachment).toHaveBeenCalledWith([imageFile], "paste");
    expect(insertContent).toHaveBeenNthCalledWith(2, [
      { type: "text", text: "after" },
    ]);
  });
});
