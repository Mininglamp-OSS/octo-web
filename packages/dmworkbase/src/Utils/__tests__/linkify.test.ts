import { describe, expect, it } from "vitest";
import { linkifySafeUrls } from "../linkify";

describe("linkifySafeUrls", () => {
  it("extracts http URL links and preserves surrounding text", () => {
    expect(
      linkifySafeUrls(
        "文字 @哈 https://github.com/Mininglamp-OSS/octo-web/issues/355 测试测试"
      )
    ).toEqual([
      { type: "text", content: "文字 @哈 " },
      {
        type: "link",
        text: "https://github.com/Mininglamp-OSS/octo-web/issues/355",
        href: "https://github.com/Mininglamp-OSS/octo-web/issues/355",
      },
      { type: "text", content: " 测试测试" },
    ]);
  });

  it("normalizes www links to https hrefs", () => {
    expect(linkifySafeUrls("官网 www.example.com")).toEqual([
      { type: "text", content: "官网 " },
      {
        type: "link",
        text: "www.example.com",
        href: "https://www.example.com",
      },
    ]);
  });

  it("keeps trailing punctuation outside the link", () => {
    expect(linkifySafeUrls("看这里 https://example.com/docs。")).toEqual([
      { type: "text", content: "看这里 " },
      {
        type: "link",
        text: "https://example.com/docs",
        href: "https://example.com/docs",
      },
      { type: "text", content: "。" },
    ]);
  });

  it.each([
    [
      "https://github.com/Ranwanglc/octo-web",
      "的main拉去分支，然后开发一下，先不推pr,好了告诉我。",
    ],
    ["https://example.com", "然后开发一下"],
    ["www.example.com/docs", "请查看"],
    ["https://example.com/a?ids=1,2#part", "这里是说明"],
    ["https://example.com/a", "，then continue"],
    ["https://example.com/a", "、https://example.com/b后续说明"],
    ["https://example.com/a%2C", "𠮷字说明"],
  ])("ends %s before adjacent prose %s", (url, prose) => {
    const content = `欧克，现在从${url}${prose}`;
    const segments = linkifySafeUrls(content);
    const expected = [url];
    if (prose.includes("https://example.com/b"))
      expected.push("https://example.com/b");
    expect(
      segments
        .filter((segment) => segment.type === "link")
        .map((segment) => segment.text)
    ).toEqual(expected);
    expect(
      segments
        .map((segment) =>
          segment.type === "link" ? segment.text : segment.content
        )
        .join("")
    ).toBe(content);
  });

  it("finds subsequent links after Chinese prose without whitespace", () => {
    const content =
      "先看https://example.com/a的说明，再看https://example.com/b然后结束";
    const segments = linkifySafeUrls(content);
    expect(
      segments
        .filter((segment) => segment.type === "link")
        .map((segment) => segment.href)
    ).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(
      segments
        .map((segment) =>
          segment.type === "link" ? segment.text : segment.content
        )
        .join("")
    ).toBe(content);
  });

  it.each([
    "https://example.com/wiki/Foo_(bar)",
    "https://example.com/a_(b_(c))",
    "https://example.com/a[b]",
    "https://example.com/a{b}",
    "https://example.com/a（b）",
    "https://example.com/a【b】",
    "https://example.com/a『b』",
    "http://[::1]",
    "https://example.com/a)b(c)",
    "https://example.com/a?ids=1,2&next=/x:y#part",
    "https://example.com/a%2C",
    "https://example.com/%E4%B8%AD%E6%96%87?q=%E6%B5%8B%E8%AF%95",
    "https://example.com/café",
  ])("preserves URL contents and matched brackets in %s", (url) => {
    const content = `(${url})，。`;
    const segments = linkifySafeUrls(content);
    expect(segments.filter((segment) => segment.type === "link")).toEqual([
      { type: "link", text: url, href: url },
    ]);
    expect(
      segments
        .map((segment) =>
          segment.type === "link" ? segment.text : segment.content
        )
        .join("")
    ).toBe(content);
  });
});
