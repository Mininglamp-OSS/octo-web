// @vitest-environment jsdom
//
// WS-117 / GH#1089 — Web 端消息里的 LaTeX 公式必须渲染（iOS 已渲染，只要一端渲染
// 所有端都渲染）。消息正文走 MarkdownContent 默认路径（enableMath 默认 true）。
//
// 关键修复（reviewer 阻塞点）：
//   1. 依赖对齐 —— react-markdown@8 用的是 mdast-util-from-markdown@1（micromark v1），
//      而 remark-math@6 依赖 micromark-extension-math@3（micromark v2），二者不兼容，
//      block(flow) 公式解析会崩：`Cannot read properties of undefined (reading
//      'mathFlowInside')`。降到 remark-math@5（micromark-extension-math@2，匹配 v1 栈）
//      后所有 block 形态（多行 / blockquote / list / CRLF）都能正常解析、不再崩。
//   2. 渲染顺序 highlight → sanitize → katex：KaTeX 输出不二次 sanitize，保住定位用的
//      内联 style（strut/pstrut），修复分数/矩阵塌陷。
//   3. `singleDollarTextMath: false` 关单 `$`：货币/shell/区间正文不被误配对成公式。
//   4. `maxSize`/`maxExpand`/`trust:false`：兜 DoS/布局炸弹，且不产生可执行 HTML。
// 文档/编辑器等需要单 `$` 的场景可显式传 allowSingleDollarMath。

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../App", () => ({
  default: {
    dataSource: { commonDataSource: { getImageURL: (src: string) => src } },
  },
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
  useI18n: () => ({ t: (key: string) => key }),
}));

import MarkdownContent from "../MarkdownContent";

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (!container) return;
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  container = null;
});

function renderContent(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(element, container);
  });
  return container;
}

describe("MarkdownContent — $$...$$ 公式渲染 (WS-117 / GH#1089)", () => {
  it("行内 $$E=mc^2$$ 渲染成 KaTeX 节点", () => {
    const root = renderContent(
      <MarkdownContent content={"能量守恒 $$E=mc^2$$ 公式"} />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
  });

  it("块级 $$\\frac{a}{b}$$ 渲染成 KaTeX 节点", () => {
    const root = renderContent(<MarkdownContent content={"$$\\frac{a}{b}$$"} />);
    expect(root.querySelector(".katex")).not.toBeNull();
  });

  it("常用子集（\\sum / \\text / 上下标 / 希腊字母）渲染成 KaTeX 节点", () => {
    const root = renderContent(
      <MarkdownContent
        content={"结果 $$ \\eta_{\\text{avg}} = \\frac{\\sum x_i}{n} $$ 完毕"}
      />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
  });

  it("无公式的普通消息渲染路径不受影响", () => {
    const root = renderContent(<MarkdownContent content="普通一条消息" />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.textContent).toBe("普通一条消息");
  });
});

describe("MarkdownContent — block/flow 公式不再崩 + display 模式 (reviewer P0)", () => {
  // remark-math@6 在 react-markdown@8 栈下，这些 block 形态全部抛 mathFlowInside 崩溃。
  // 降到 remark-math@5 后必须：不崩、渲染、且块级上下文带 .katex-display。
  const blockCases: Array<[string, string]> = [
    ["多行 $$\\n..\\n$$", "$$\n\\frac{a}{b}\n$$"],
    ["blockquote 内 block math", "> $$\n> \\frac{a}{b}\n> $$"],
    ["list 内 block math", "- 项\n\n  $$\n  \\frac{a}{b}\n  $$"],
    ["CRLF 换行的 $$", "$$\r\n\\frac{a}{b}\r\n$$"],
  ];
  for (const [name, content] of blockCases) {
    it(`不崩且以 display 模式渲染：${name}`, () => {
      const root = renderContent(<MarkdownContent content={content} />);
      expect(root.querySelector(".katex")).not.toBeNull();
      expect(root.querySelector(".katex-display")).not.toBeNull();
    });
  }

  it("未闭合的流式 $$ 前缀不崩（渲染成文本，等后续 chunk）", () => {
    const root = renderContent(
      <MarkdownContent content={"正在计算 $$\\sum_{i=1}^n i ="} isStreaming />
    );
    // 不抛异常即达标；未闭合公式按文本处理，不产生 .katex
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.textContent).toContain("正在计算");
  });
});

describe("MarkdownContent — KaTeX 布局定位样式不被 sanitize 剥掉", () => {
  it("分数保留 strut 内联定位样式（不塌陷）", () => {
    const root = renderContent(<MarkdownContent content={"$$\\frac{a}{b}$$"} />);
    const strut = root.querySelector<HTMLElement>(".katex-html .strut");
    expect(strut).not.toBeNull();
    expect(strut?.getAttribute("style")).toBeTruthy();
  });

  it("矩阵保留 mtable 结构与定位样式", () => {
    const root = renderContent(
      <MarkdownContent
        content={"$$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$$"}
      />
    );
    expect(root.querySelector(".katex .mtable")).not.toBeNull();
    const strut = root.querySelector<HTMLElement>(".katex-html .strut");
    expect(strut?.getAttribute("style")).toBeTruthy();
  });
});

describe("MarkdownContent — 安全 / DoS 边界", () => {
  it("maxSize 把 \\rule 超大尺寸夹到有界值", () => {
    const root = renderContent(
      <MarkdownContent content={"$$\\rule{99999em}{99999em}$$"} />
    );
    const struts = root.querySelectorAll<HTMLElement>(".katex-html .strut");
    expect(struts.length).toBeGreaterThan(0);
    for (const s of struts) {
      expect(parseFloat(s.style.height || "0")).toBeLessThanOrEqual(10);
    }
  });

  it("trust:false 下 \\href{javascript:...} 不产生可执行 href", () => {
    const root = renderContent(
      <MarkdownContent content={"$$\\href{javascript:alert(1)}{x}$$"} />
    );
    // javascript: 只可能残留在不可执行的 MathML annotation 源码里，绝不能是 href 属性
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    const anchors = Array.from(root.querySelectorAll("a"));
    for (const a of anchors) {
      expect(a.getAttribute("href") || "").not.toContain("javascript:");
    }
  });
});

describe("MarkdownContent — 成对/单个 $ 正文不被误渲成公式 (reviewer 阻塞点)", () => {
  const cases: string[] = [
    "价格是 $100",
    "price is $5-$10",
    "cost $5 and $10",
    "export PATH=$HOME/bin:$PATH",
    "价格是 $100 到 $200 之间",
    "a $20,000 and $30,000 range",
  ];
  for (const input of cases) {
    it(`不误渲染且正文完整：${JSON.stringify(input)}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      expect(root.textContent).toBe(input);
    });
  }
});

describe("MarkdownContent — allowSingleDollarMath 显式开启单 $ (文档/编辑器场景)", () => {
  it("开启后行内 $E=mc^2$ 渲染成 KaTeX 节点", () => {
    const root = renderContent(
      <MarkdownContent content={"值 $E=mc^2$ 结束"} allowSingleDollarMath />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
  });

  it("默认（不开启）时单 $E=mc^2$ 按纯文本、不渲染公式", () => {
    const root = renderContent(<MarkdownContent content={"值 $E=mc^2$ 结束"} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.textContent).toBe("值 $E=mc^2$ 结束");
  });

  it("enableMath={false} 时即便有 $$ 也不渲染公式", () => {
    const root = renderContent(
      <MarkdownContent content={"$$E=mc^2$$"} enableMath={false} />
    );
    expect(root.querySelector(".katex")).toBeNull();
  });
});
