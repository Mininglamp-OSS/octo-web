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
