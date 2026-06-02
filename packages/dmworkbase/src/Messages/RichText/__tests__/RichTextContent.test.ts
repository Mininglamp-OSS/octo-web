import { describe, it, expect, vi } from "vitest";

// MessageContent base from the SDK only needs to be a constructable class for
// RichTextContent to extend; the digest fallback uses i18n t().
vi.mock("wukongimjssdk", () => ({
  MessageContent: class {
    contentObj: any;
    contentType!: number;
    decodeJSON(_: any): void {}
    encodeJSON(): any {
      return {};
    }
    get conversationDigest() {
      return "";
    }
  },
}));

vi.mock("../../../i18n", () => ({
  // 静态兜底文案：与 message.digest.richText 对应
  t: () => "[富文本]",
}));

import {
  RichTextContent,
  buildRichTextPlain,
  RichTextImagePlaceholder,
} from "../RichTextContent";

describe("buildRichTextPlain", () => {
  it("拼接 text，image 注入占位符，保留顺序", () => {
    const plain = buildRichTextPlain([
      { type: "text", text: "看图：" },
      { type: "image", url: "https://x/a.png" },
      { type: "text", text: " 完成" },
    ]);
    expect(plain).toBe(`看图：${RichTextImagePlaceholder} 完成`);
  });

  it("未知 type 有 text 则取 text，否则跳过", () => {
    expect(
      buildRichTextPlain([
        { type: "future", text: "hi" },
        { type: "future" },
      ])
    ).toBe("hi");
  });
});

describe("RichTextContent.decodeJSON", () => {
  it("解析 blocks 数组并优先用 server plain", () => {
    const c = new RichTextContent();
    c.decodeJSON({
      type: 14,
      content: [
        { type: "text", text: "hello" },
        { type: "image", url: "https://x/a.png", width: 10, height: 20 },
      ],
      plain: "hello[图片]",
    });
    expect(c.content).toHaveLength(2);
    expect(c.content[1].url).toBe("https://x/a.png");
    expect(c.plain).toBe("hello[图片]");
    expect(c.conversationDigest).toBe("hello[图片]");
  });

  it("plain 缺失时现场遍历 blocks 回填（不丢字）", () => {
    const c = new RichTextContent();
    c.decodeJSON({
      type: 14,
      content: [
        { type: "text", text: "a" },
        { type: "image", url: "https://x/a.png" },
      ],
    });
    expect(c.plain).toBe(`a${RichTextImagePlaceholder}`);
    expect(c.conversationDigest).toBe(`a${RichTextImagePlaceholder}`);
  });

  it("向后兼容：content 为纯字符串归一为单个 text block", () => {
    const c = new RichTextContent();
    c.decodeJSON({ type: 14, content: "legacy text" });
    expect(c.content).toEqual([{ type: "text", text: "legacy text" }]);
    expect(c.plain).toBe("legacy text");
  });

  it("空内容回退到静态摘要文案", () => {
    const c = new RichTextContent();
    c.decodeJSON({ type: 14, content: [] });
    expect(c.plain).toBe("");
    expect(c.conversationDigest).toBe("[富文本]");
  });
});
