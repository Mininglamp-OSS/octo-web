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
});
