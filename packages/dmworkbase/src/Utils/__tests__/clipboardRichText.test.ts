// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyRichTextToClipboard } from "../clipboard";
import {
  RichTextContent,
  RichTextImagePlaceholder,
} from "../../Messages/RichText/RichTextContent";
import {
  encodeOctoRichTextClipboardPayload,
  extractOctoRichTextClipboardPayloadFromHtml,
} from "../richTextClipboard";

vi.mock("wukongimjssdk", () => ({
  MessageContent: class {
    contentObj: any;
    contentType!: number;
  },
}));

vi.mock("../../Service/Const", () => ({
  MessageContentTypeConst: { richText: 14 },
}));

vi.mock("../../i18n", () => ({
  t: () => "",
}));

vi.mock("../../App", () => ({
  default: {
    dataSource: {
      commonDataSource: {
        getImageURL: (url: string) => url,
      },
    },
  },
}));

class MockClipboardItem {
  items: Record<string, Blob>;
  constructor(items: Record<string, Blob>) {
    this.items = items;
  }
}

describe("copyRichTextToClipboard", () => {
  beforeEach(() => {
    (globalThis as any).ClipboardItem = MockClipboardItem;
    (document as any).execCommand = undefined;
  });

  it("writes text/html plus text/plain so images survive rich paste", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });

    const content = new RichTextContent();
    content.content = [
      { type: "text", text: "看图：" },
      {
        type: "image",
        url: "https://cdn.example.com/a.png",
        width: 10,
        height: 20,
        name: "a.png",
      },
      { type: "text", text: " @Alice" },
    ];
    content.plain = "看图：[图片] @Alice";
    (content as any).mention = {
      entities: [
        {
          uid: "alice",
          offset: "看图：".length + RichTextImagePlaceholder.length + 1,
          length: "@Alice".length,
        },
      ],
    };

    await expect(copyRichTextToClipboard(content)).resolves.toBe(true);

    const item = write.mock.calls[0][0][0] as MockClipboardItem;
    expect(Object.keys(item.items).sort()).toEqual(["text/html", "text/plain"]);
    await expect(item.items["text/html"].text()).resolves.toContain(
      '<img src="https://cdn.example.com/a.png" alt="a.png" />'
    );
    const html = await item.items["text/html"].text();
    const payload = extractOctoRichTextClipboardPayloadFromHtml(html);
    expect(payload?.blocks).toEqual([
      { type: "text", text: "看图：" },
      {
        type: "image",
        url: "https://cdn.example.com/a.png",
        width: 10,
        height: 20,
        name: "a.png",
      },
      {
        type: "text",
        text: " @Alice",
        mentions: [{ uid: "alice", offset: 1, length: "@Alice".length }],
      },
    ]);
    await expect(item.items["text/plain"].text()).resolves.toBe(
      "看图：[图片] @Alice"
    );
  });

  it("falls back to execCommand with text/html when ClipboardItem write fails", async () => {
    const write = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });

    const copied: Record<string, string> = {};
    (document as any).execCommand = vi.fn((command: string) => {
      if (command !== "copy") return false;
      const event = new Event("copy", {
        bubbles: true,
        cancelable: true,
      }) as ClipboardEvent;
      Object.defineProperty(event, "clipboardData", {
        value: {
          setData: (type: string, value: string) => {
            copied[type] = value;
          },
        },
      });
      document.dispatchEvent(event);
      return true;
    });

    const content = new RichTextContent();
    content.content = [
      { type: "text", text: "before" },
      {
        type: "image",
        url: "https://cdn.example.com/a.png",
        width: 10,
        height: 20,
        name: "a.png",
      },
      { type: "text", text: "after" },
    ];
    content.plain = "before[图片]after";

    await expect(copyRichTextToClipboard(content)).resolves.toBe(true);

    expect(write).toHaveBeenCalled();
    expect(copied["text/html"]).toContain("data-octo-richtext");
    expect(copied["text/html"]).toContain(
      '<img src="https://cdn.example.com/a.png" alt="a.png" />'
    );
    expect(copied["text/plain"]).toBe("before[图片]after");
    expect(
      extractOctoRichTextClipboardPayloadFromHtml(copied["text/html"])?.blocks
    ).toEqual([
      { type: "text", text: "before" },
      {
        type: "image",
        url: "https://cdn.example.com/a.png",
        width: 10,
        height: 20,
        name: "a.png",
      },
      { type: "text", text: "after" },
    ]);
  });

  it("extracts the marker without parsing clipboard html as DOM", () => {
    const encoded = encodeOctoRichTextClipboardPayload({
      version: 1,
      blocks: [{ type: "text", text: "safe" }],
      plain: "safe",
    });
    const originalDOMParser = (globalThis as any).DOMParser;
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: class {
        parseFromString() {
          throw new Error("should not parse clipboard html");
        }
      },
    });

    try {
      const payload = extractOctoRichTextClipboardPayloadFromHtml(
        `<img src=x onerror=alert(1)><span data-octo-richtext="${encoded}"></span>`
      );
      expect(payload?.blocks).toEqual([{ type: "text", text: "safe" }]);
    } finally {
      Object.defineProperty(globalThis, "DOMParser", {
        configurable: true,
        value: originalDOMParser,
      });
    }
  });

  it("rejects non-base64url marker attributes", () => {
    expect(
      extractOctoRichTextClipboardPayloadFromHtml(
        `<span data-octo-richtext="<img src=x onerror=alert(1)>"></span>`
      )
    ).toBeNull();
  });
});
