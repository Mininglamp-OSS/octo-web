// @vitest-environment jsdom
//
// WS-117 / GH#1089 — Web 端消息里的 LaTeX 公式必须渲染（iOS 已渲染，只要一端渲染
// 所有端都渲染）。消息正文走 MarkdownContent 默认路径（enableMath 默认 true），
// 断言 `$...$`（行内）与 `$$...$$`（块级）产出 KaTeX 节点，且单个 `$` 货币场景
// （如「价格是 $100」）不误触发公式渲染。

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

describe("MarkdownContent — LaTeX 公式默认渲染 (WS-117 / GH#1089)", () => {
  it("行内公式 $E=mc^2$ 渲染成 KaTeX 节点", () => {
    const root = renderContent(<MarkdownContent content="能量守恒 $E=mc^2$ 公式" />);
    expect(root.querySelector(".katex")).not.toBeNull();
  });

  it("块级公式 $$\\frac{a}{b}$$ 渲染成 KaTeX 节点", () => {
    const root = renderContent(<MarkdownContent content={"$$\\frac{a}{b}$$"} />);
    expect(root.querySelector(".katex")).not.toBeNull();
  });

  it("常用子集（\\sum / \\text / 上下标 / 希腊字母）渲染成 KaTeX 节点", () => {
    const root = renderContent(
      <MarkdownContent
        content={"$$ \\eta_{\\text{avg}} = \\frac{\\sum x_i}{n} $$"}
      />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
  });

  it("单个 $ 货币（价格是 $100）不误触发公式渲染", () => {
    const root = renderContent(<MarkdownContent content="价格是 $100" />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.textContent).toBe("价格是 $100");
  });

  it("无公式的普通消息渲染路径不受影响", () => {
    const root = renderContent(<MarkdownContent content="普通一条消息" />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.textContent).toBe("普通一条消息");
  });

  it("enableMath={false} 时不渲染公式（保留调用方显式关闭的能力）", () => {
    const root = renderContent(
      <MarkdownContent content="能量守恒 $E=mc^2$ 公式" enableMath={false} />
    );
    expect(root.querySelector(".katex")).toBeNull();
  });
});
