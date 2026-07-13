// @vitest-environment jsdom
//
// S1 markdown 字符串管线：cardMarkdownToSafeHtml 复用 CardMarkdown 的 sanitize/allowlist，
// 产出安全 HTML 字符串供 SDK onProcessMarkdown 使用。

import { describe, expect, it } from "vitest";
import { cardMarkdownToSafeHtml } from "../renderer/cardMarkdownHtml";

describe("cardMarkdownToSafeHtml", () => {
  it("粗体/斜体/列表/链接正常渲染", () => {
    const html = cardMarkdownToSafeHtml("**粗** *斜* 与[链接](https://example.com)");
    expect(html).toContain("<strong>粗</strong>");
    expect(html).toContain("<em>斜</em>");
    expect(html).toContain('href="https://example.com"');
    const list = cardMarkdownToSafeHtml("- a\n- b");
    expect(list).toContain("<li>");
  });

  it("合法链接强制 target=_blank + rel=noopener", () => {
    const html = cardMarkdownToSafeHtml("[x](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
  });

  it("javascript: 链接降级为纯文本，不产出 href", () => {
    const html = cardMarkdownToSafeHtml("点[这里](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
    expect(html).toContain("这里");
  });

  it("data: 链接降级，不产出 href", () => {
    const html = cardMarkdownToSafeHtml("[x](data:text/html,<script>1</script>)");
    expect(html).not.toContain("data:text/html");
    expect(html).not.toContain("<a ");
  });

  it("raw HTML 被 skipHtml 丢弃（不透出 <script>/<img>）", () => {
    const html = cardMarkdownToSafeHtml(
      "文本<script>alert(1)</script>和<img src=x onerror=alert(1)>"
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("文本");
  });

  it("空文本安全返回", () => {
    expect(typeof cardMarkdownToSafeHtml("")).toBe("string");
  });
});
