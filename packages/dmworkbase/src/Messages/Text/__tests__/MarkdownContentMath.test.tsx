// @vitest-environment jsdom
//
// WS-117 / GH#1089 — Web 端消息里的 LaTeX 公式必须渲染（iOS 已渲染，只要一端渲染
// 所有端都渲染）。消息正文走 MarkdownContent 默认路径（enableMath 默认 true）。
//
// 策略：默认只认 `$$...$$`（行内 + 块级），关闭单 `$...$` 行内公式。原因是聊天正文里
// 成对单 `$`（货币区间 `$5-$10`、费用对比 `$5 and $10`、shell/环境变量
// `$HOME/bin:$PATH`）会被 remark-math 误配对成 inline math、损坏正文；单 `$` 与
// 这些语义天然歧义、无可靠 heuristic 区分，故收窄到 `$$`。文档/编辑器等需要单 `$`
// 的场景可显式传 allowSingleDollarMath。

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

describe("MarkdownContent — 默认渲染 $$...$$ 公式 (WS-117 / GH#1089)", () => {
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

  it("常用子集（\\sum / \\text / 上下标 / 希腊字母）渲染成 KaTeX 节点（复现原始 bug 消息）", () => {
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

describe("MarkdownContent — 成对/单个 $ 正文不被误渲成公式 (reviewer 阻塞点)", () => {
  // 每条都是聊天里常见、会被单 `$...$` 误配对损坏的正文；默认策略必须原样保留。
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
