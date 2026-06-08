// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyRichTextToClipboard } from "../clipboard";
import { RichTextContent } from "../../Messages/RichText/RichTextContent";

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

    await expect(copyRichTextToClipboard(content)).resolves.toBe(true);

    const item = write.mock.calls[0][0][0] as MockClipboardItem;
    expect(Object.keys(item.items).sort()).toEqual(["text/html", "text/plain"]);
    await expect(item.items["text/html"].text()).resolves.toContain(
      '<img src="https://cdn.example.com/a.png" alt="a.png" />'
    );
    await expect(item.items["text/plain"].text()).resolves.toBe(
      "看图：[图片] @Alice"
    );
  });
});
