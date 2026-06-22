// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

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
  imageBlockToPasteFile,
  MAX_PASTE_IMAGE_BYTES,
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

function mockImageResponse(blob: Blob, headers: Record<string, string> = {}) {
  return {
    ok: true,
    headers: new Headers({
      "Content-Type": blob.type || "image/png",
      ...headers,
    }),
    blob: vi.fn().mockResolvedValue(blob),
  };
}

describe("richTextPaste", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds inline content with mention nodes and hard breaks", () => {
    expect(
      buildInlineContentForRichTextPaste(
        "hi @Alice\nnext",
        [{ uid: "alice", offset: 3, length: "@Alice".length }],
        [{ uid: "alice", name: "Alice" }]
      )
    ).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", attrs: { id: "alice", label: "Alice" } },
      { type: "hardBreak" },
      { type: "text", text: "next" },
    ]);
  });

  it("keeps a valid in-channel mention matched on the canonical label", () => {
    expect(
      buildInlineContentForRichTextPaste(
        "ping @Bob Smith done",
        [{ uid: "bob", offset: 5, length: "@Bob Smith".length }],
        [{ uid: "bob", name: "bob-alias", label: "Bob Smith" }]
      )
    ).toEqual([
      { type: "text", text: "ping " },
      { type: "mention", attrs: { id: "bob", label: "Bob Smith" } },
      { type: "text", text: " done" },
    ]);
  });

  it.each([
    ["-1", "legacy @所有人"],
    ["-2", "humans sentinel"],
    ["-3", "ais sentinel"],
    ["all", "render-side synthetic"],
  ])(
    "degrades a broadcast sentinel mention (%s) to plain text",
    (uid) => {
      expect(
        buildInlineContentForRichTextPaste(
          "hey @所有人 hello",
          [{ uid, offset: 4, length: "@所有人".length }],
          // Even if the forged payload also lists the sentinel as a "member",
          // a broadcast sentinel must never reconstruct a mention node.
          [{ uid, name: "所有人" }]
        )
      ).toEqual([
        { type: "text", text: "hey " },
        { type: "text", text: "@所有人" },
        { type: "text", text: " hello" },
      ]);
    }
  );

  it("degrades a pasted mention whose uid is not a current channel member", () => {
    expect(
      buildInlineContentForRichTextPaste(
        "hi @Alice next",
        [{ uid: "attacker", offset: 3, length: "@Alice".length }],
        [{ uid: "alice", name: "Alice" }]
      )
    ).toEqual([
      { type: "text", text: "hi " },
      { type: "text", text: "@Alice" },
      { type: "text", text: " next" },
    ]);
  });

  it("degrades a pasted mention whose label does not match the member name", () => {
    expect(
      buildInlineContentForRichTextPaste(
        "hi @Administrator next",
        [{ uid: "alice", offset: 3, length: "@Administrator".length }],
        [{ uid: "alice", name: "Alice" }]
      )
    ).toEqual([
      { type: "text", text: "hi " },
      { type: "text", text: "@Administrator" },
      { type: "text", text: " next" },
    ]);
  });

  it("degrades every pasted mention when no members list is provided", () => {
    expect(
      buildInlineContentForRichTextPaste("hi @Alice next", [
        { uid: "alice", offset: 3, length: "@Alice".length },
      ])
    ).toEqual([
      { type: "text", text: "hi " },
      { type: "text", text: "@Alice" },
      { type: "text", text: " next" },
    ]);
  });

  it("threads members through restore so a forged mention degrades but a valid one survives", async () => {
    const { editor, insertContent } = fakeEditor();

    await restoreOctoRichTextClipboardToEditor(
      {
        version: 1,
        blocks: [
          {
            type: "text",
            text: "hi @Alice and @所有人",
            mentions: [
              { uid: "alice", offset: 3, length: "@Alice".length },
              { uid: "-2", offset: 14, length: "@所有人".length },
            ],
          },
        ],
      },
      editor,
      vi.fn(),
      { members: [{ uid: "alice", name: "Alice" }] }
    );

    expect(insertContent).toHaveBeenCalledWith([
      { type: "text", text: "hi " },
      { type: "mention", attrs: { id: "alice", label: "Alice" } },
      { type: "text", text: " and " },
      { type: "text", text: "@所有人" },
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

  it("falls back to the image placeholder when the validated attachment path rejects the file", async () => {
    const { editor, insertContent } = fakeEditor();
    const imageFile = new File(["image"], "a.png", { type: "image/png" });
    const addAttachment = vi.fn().mockResolvedValue(false);

    await restoreOctoRichTextClipboardToEditor(
      {
        version: 1,
        blocks: [{ type: "image", url: "https://cdn.example.com/a.png" }],
      },
      editor,
      addAttachment,
      {
        imageBlockToFile: vi.fn().mockResolvedValue(imageFile),
      }
    );

    expect(addAttachment).toHaveBeenCalledWith([imageFile], "paste");
    expect(insertContent).toHaveBeenCalledWith([
      { type: "text", text: "[图片]" },
    ]);
  });

  it("fetches pasted images without credentials for wildcard CORS CDNs", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    const fetch = vi.fn().mockResolvedValue(mockImageResponse(blob));
    vi.stubGlobal("fetch", fetch);

    const file = await imageBlockToPasteFile(
      {
        type: "image",
        url: "https://cdn.example.com/a.png",
        name: "a.png",
      },
      (url) => url
    );

    expect(fetch).toHaveBeenCalledWith("https://cdn.example.com/a.png", {
      mode: "cors",
      credentials: "omit",
    });
    expect(file?.name).toBe("a.png");
    expect(file?.type).toBe("image/png");
  });

  it("omits credentials for same-origin pasted images by default", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    const fetch = vi.fn().mockResolvedValue(mockImageResponse(blob));
    vi.stubGlobal("fetch", fetch);

    const url = `${window.location.origin}/assets/a.png`;
    await imageBlockToPasteFile(
      {
        type: "image",
        url,
        name: "a.png",
      },
      (url) => url
    );

    expect(fetch).toHaveBeenCalledWith(url, {
      mode: "cors",
      credentials: "omit",
    });
  });

  it("rejects pasted images whose Content-Length exceeds the fetch cap", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    const response = mockImageResponse(blob, {
      "Content-Length": String(MAX_PASTE_IMAGE_BYTES + 1),
    });
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);

    const file = await imageBlockToPasteFile(
      {
        type: "image",
        url: "https://cdn.example.com/huge.png",
        name: "huge.png",
      },
      (url) => url
    );

    expect(file).toBeNull();
    expect(response.blob).not.toHaveBeenCalled();
  });

  it("rejects pasted images whose blob size exceeds the fetch cap", async () => {
    const blob = { size: MAX_PASTE_IMAGE_BYTES + 1, type: "image/png" } as Blob;
    const fetch = vi.fn().mockResolvedValue(mockImageResponse(blob));
    vi.stubGlobal("fetch", fetch);

    const file = await imageBlockToPasteFile(
      {
        type: "image",
        url: "https://cdn.example.com/huge.png",
        name: "huge.png",
      },
      (url) => url
    );

    expect(file).toBeNull();
  });

  it("rejects fetched clipboard blobs that are not images", async () => {
    const blob = new Blob(["html"], { type: "text/html" });
    const fetch = vi.fn().mockResolvedValue(mockImageResponse(blob));
    vi.stubGlobal("fetch", fetch);

    const file = await imageBlockToPasteFile(
      {
        type: "image",
        url: "https://cdn.example.com/not-image",
        name: "not-image.html",
      },
      (url) => url
    );

    expect(file).toBeNull();
  });
});
