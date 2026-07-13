// @vitest-environment jsdom
//
// cardMarkdown 受限渲染测试：验证 octo/v1 可见子集（粗体/斜体/列表/链接）正确渲染，
// 子集外语法（表格/代码块/标题/图片）不解析成对应 HTML，且链接安全降级。

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { CardMarkdown } from "../renderer/cardMarkdown";

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (!container) return;
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  container = null;
});

function render(text: string): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(<CardMarkdown text={text} />, container!);
  });
  return container;
}

describe("cardMarkdown — 可见子集渲染", () => {
  it("粗体 → <strong>", () => {
    const root = render("**重要**");
    expect(root.querySelector("strong")?.textContent).toBe("重要");
  });

  it("斜体 → <em>", () => {
    const root = render("*强调*");
    expect(root.querySelector("em")?.textContent).toBe("强调");
  });

  it("无序列表 → <ul><li>", () => {
    const root = render("- a\n- b");
    expect(root.querySelectorAll("ul li").length).toBe(2);
  });

  it("有序列表 → <ol><li>", () => {
    const root = render("1. a\n2. b");
    expect(root.querySelectorAll("ol li").length).toBe(2);
  });

  it("合法 https 链接 → <a target=_blank rel=noopener noreferrer>", () => {
    const root = render("[官网](https://example.com)");
    const a = root.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("cardMarkdown — 子集外语法不渲染（跨端一致）", () => {
  it("标题不渲染成 <h1>", () => {
    const root = render("# 标题");
    expect(root.querySelector("h1")).toBeNull();
    // 文本仍可见（unwrap 成纯文本）
    expect(root.textContent).toContain("标题");
  });

  it("代码块不渲染成 <pre>/<code>", () => {
    const root = render("```\ncode\n```");
    expect(root.querySelector("pre")).toBeNull();
    expect(root.querySelector("code")).toBeNull();
  });

  it("GFM 表格不渲染成 <table>", () => {
    const root = render("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(root.querySelector("table")).toBeNull();
  });

  it("markdown 图片不渲染成 <img>", () => {
    const root = render("![alt](https://example.com/x.png)");
    expect(root.querySelector("img")).toBeNull();
  });
});

describe("cardMarkdown — 链接安全降级", () => {
  it("javascript: 链接降级为纯文本，不产出 <a>", () => {
    const root = render("[x](javascript:alert(1))");
    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toContain("x");
  });

  it("data: 链接降级为纯文本", () => {
    const root = render("[y](data:text/html,<script>)");
    expect(root.querySelector("a")).toBeNull();
  });

  it("octo:// 深链降级为纯文本", () => {
    const root = render("[z](octo://open)");
    expect(root.querySelector("a")).toBeNull();
  });

  it("原始 HTML 被丢弃（skipHtml），不产出 <script>", () => {
    const root = render("安全文本\n\n<script>alert(1)</script>");
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain("安全文本");
  });
});
