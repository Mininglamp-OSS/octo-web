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
  RichTextFilePlaceholder,
  RichTextImagePlaceholder,
  makeTextBlock,
  makeImageBlock,
  createRichTextContent,
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

  it("file block 前向兼容：plain 注入文件占位符和文件名", () => {
    const plain = buildRichTextPlain([
      { type: "text", text: "参考：" },
      {
        type: "file",
        name: "需求说明.pdf",
        url: "https://x/a.pdf",
        size: 1024,
      },
    ]);
    expect(plain).toBe(`参考：${RichTextFilePlaceholder} 需求说明.pdf`);
  });

  it("未知 type 有 text 则取 text，否则跳过", () => {
    expect(
      buildRichTextPlain([{ type: "future", text: "hi" }, { type: "future" }])
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

  it("前向兼容：解析 file block 需要的展示字段", () => {
    const c = new RichTextContent();
    c.decodeJSON({
      type: 14,
      content: [
        {
          type: "file",
          url: "https://x/a.pdf",
          name: "需求说明.pdf",
          extension: "pdf",
          size: 2048,
          mime: "application/pdf",
          caption: "正文里的文件",
        },
      ],
    });
    expect(c.content[0]).toMatchObject({
      type: "file",
      url: "https://x/a.pdf",
      name: "需求说明.pdf",
      extension: "pdf",
      size: 2048,
      mime: "application/pdf",
      caption: "正文里的文件",
    });
    expect(c.conversationDigest).toBe(
      `${RichTextFilePlaceholder} 需求说明.pdf`
    );
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

describe("发送侧 block 构造（与接收侧 schema 对称）", () => {
  it("makeTextBlock 产出 text block", () => {
    expect(makeTextBlock("hi")).toEqual({ type: "text", text: "hi" });
  });

  it("makeImageBlock 必填 url/width/height，size/name 仅在有值时带上", () => {
    expect(
      makeImageBlock({ url: "https://x/a.png", width: 10, height: 20 })
    ).toEqual({ type: "image", url: "https://x/a.png", width: 10, height: 20 });

    expect(
      makeImageBlock({
        url: "https://x/a.png",
        width: 10,
        height: 20,
        size: 123,
        name: "a.png",
      })
    ).toEqual({
      type: "image",
      url: "https://x/a.png",
      width: 10,
      height: 20,
      size: 123,
      name: "a.png",
    });

    // size=0 不应注入 wire（防 byte-match 污染）
    expect(
      makeImageBlock({ url: "https://x/a.png", width: 1, height: 1, size: 0 })
    ).not.toHaveProperty("size");
  });

  it("createRichTextContent 本地填 plain 占位（image→占位符），与 buildRichTextPlain 对称", () => {
    const blocks = [
      makeTextBlock("看图："),
      makeImageBlock({ url: "https://x/a.png", width: 10, height: 20 }),
    ];
    const c = createRichTextContent(blocks);
    expect(c.content).toBe(blocks);
    expect(c.plain).toBe(`看图：${RichTextImagePlaceholder}`);
  });

  it("encodeJSON↔decodeJSON 往返：发送构造的 payload 可被接收侧解析回同一 blocks", () => {
    const sent = createRichTextContent([
      makeTextBlock("hello"),
      makeImageBlock({ url: "https://x/a.png", width: 10, height: 20 }),
    ]);
    const wire = sent.encodeJSON();
    const received = new RichTextContent();
    received.decodeJSON(wire);
    expect(received.content[0]).toMatchObject({ type: "text", text: "hello" });
    expect(received.content[1]).toMatchObject({
      type: "image",
      url: "https://x/a.png",
      width: 10,
      height: 20,
    });
  });
});
