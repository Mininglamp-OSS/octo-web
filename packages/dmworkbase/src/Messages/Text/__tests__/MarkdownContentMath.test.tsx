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
//   3. iOS 对齐的 math-ish 守卫（mathGuardPlugin）：默认路径识别 `$...$` / `$$...$$`，
//      但只有内部含 `\ ^ _ { }` 之一的片段才当公式，`$100` / `$5-$10` / `cost $$5 and $$10`
//      等金额/shell 正文保持原文。与 iOS WKLaTeXPreprocessor.hasMathChar 行为一致，
//      从而 `$E=mc^2$` 两端都渲染、货币两端都不误触发。
//   4. `maxSize`/`maxExpand`/`trust:false`：兜 DoS/布局炸弹，且不产生可执行 HTML。
// 文档/编辑器等要“无守卫、简单 $a+b$ 也渲染”的场景可显式传 allowSingleDollarMath。

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

/** KaTeX 会额外挂一份仅无障碍用的 MathML 镜像（.katex-mathml），比对可见文本时要剔除。 */
function visibleText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(".katex-mathml")
    .forEach((n) => n.parentNode?.removeChild(n));
  return clone.textContent ?? "";
}

describe("MarkdownContent — #1089 手动验收字符串必须渲染 (WS-117)", () => {
  // 直接用 issue #1089 验收区写死的那条消息：单 $E=mc^2$ + 块级 $$\frac{a}{b}$$，
  // Web 端应看到两处渲染后的公式（对齐 iOS）。
  it("单 $E=mc^2$ 与 $$\\frac{a}{b}$$ 同条消息各渲染一处公式", () => {
    const root = renderContent(
      <MarkdownContent content={"质能方程 $E=mc^2$ 与 $$\\frac{a}{b}$$"} />
    );
    expect(root.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
  });

  it("默认路径下单 $E=mc^2$ 渲染成 KaTeX 节点（含 ^，是真公式）", () => {
    const root = renderContent(<MarkdownContent content={"值 $E=mc^2$ 结束"} />);
    expect(root.querySelector(".katex")).not.toBeNull();
  });

  it("默认路径下 $x_1$（含下标 _）渲染成 KaTeX 节点", () => {
    const root = renderContent(<MarkdownContent content={"设 $x_1$ 为初值"} />);
    expect(root.querySelector(".katex")).not.toBeNull();
  });
});

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

  it("流式：同一实例从未闭合 $$ 前缀 → 补全后正常渲染公式", () => {
    // 复用同一个 container / 同一组件实例，先渲染半截 $$ 再补全，验证未闭合定界符
    // 不会污染后续渲染（reviewer P2#2）。
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      ReactDOM.render(
        <MarkdownContent content={"推导 $$\\frac{a}"} isStreaming />,
        container
      );
    });
    expect(container.querySelector(".katex")).toBeNull();
    act(() => {
      ReactDOM.render(
        <MarkdownContent content={"推导 $$\\frac{a}{b}$$"} isStreaming />,
        container
      );
    });
    expect(container.querySelector(".katex")).not.toBeNull();
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
  it("maxSize 把 \\rule 超大尺寸夹到有界值（高与宽都夹）", () => {
    const root = renderContent(
      <MarkdownContent content={"$$\\rule{99999em}{99999em}$$"} />
    );
    const struts = root.querySelectorAll<HTMLElement>(".katex-html .strut");
    expect(struts.length).toBeGreaterThan(0);
    for (const s of struts) {
      expect(parseFloat(s.style.height || "0")).toBeLessThanOrEqual(10);
    }
    // 宽度同样被 maxSize 夹住（reviewer P2#3：不能只断言高度）。
    const rule = root.querySelector<HTMLElement>(".rule");
    if (rule) {
      expect(
        parseFloat(rule.style.borderRightWidth || "0")
      ).toBeLessThanOrEqual(10);
    }
    // 夹尺寸后仍然是正常渲染，不应退化成 KaTeX 错误节点。
    expect(root.querySelector(".katex-error")).toBeNull();
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

describe("MarkdownContent — 单 $ 正文不被误渲成公式 (reviewer 阻塞点)", () => {
  // 这些都是「配对的单 $，但内部无 \\ ^ _ { } 数学字符」的普通正文：math-ish 守卫应还原原文。
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
      expect(visibleText(root)).toBe(input);
    });
  }
});

describe("MarkdownContent — 成对 $$ 正文不被误渲成公式 (reviewer §3 阻塞点)", () => {
  // 上一轮把默认收窄到 $$ only 并没堵住正文误配对：内部无数学字符的 $$...$$ 仍会吃字重排。
  // math-ish 守卫对 $ 与 $$ 一视同仁，这些普通正文必须原样保留。
  const cases: string[] = [
    "花了 $$100，又花了 $$200",
    "cost $$5 and $$10",
    "echo $$ then echo $$ again",
    "US$$50 vs HK$$50",
    "预算 $$1000 万，实际 $$1200 万",
  ];
  for (const input of cases) {
    it(`不误渲染且正文完整：${JSON.stringify(input)}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      expect(visibleText(root)).toBe(input);
    });
  }
});

describe("MarkdownContent — 代码内的 $ / $$ 永远不当公式（守卫范围仅正文）", () => {
  it("行内代码 `echo $$` 原样保留、不渲染公式", () => {
    const root = renderContent(
      <MarkdownContent content={"跑一下 `echo $$ pid` 看看"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.querySelector("code")?.textContent).toContain("echo $$ pid");
  });

  it("围栏代码块内 $$ 原样保留、不渲染公式", () => {
    const root = renderContent(
      <MarkdownContent content={"```sh\necho $$ then echo $$ again\n```"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.querySelector("pre")?.textContent).toContain(
      "echo $$ then echo $$ again"
    );
  });
});

describe("MarkdownContent — 公式内部不被 mention/emoji 分段污染 (reviewer addendum P2)", () => {
  it("KaTeX 输出层不注入 mention span / emoji img，MathML / annotation 保持纯净", () => {
    // "mc" 命中 annotation 里的 E=mc^2：修复前 processTextChildren 会递归进 .katex
    // 子树，把 mention <span>/emoji <img> 插进 MathML <mtext> 与 x-tex annotation。
    const root = renderContent(
      <MarkdownContent
        content={"你好 @小明 看公式 $$E=mc^2$$"}
        mentions={[
          { name: "@小明", uid: "u1" },
          { name: "mc", uid: "u2" },
        ]}
        emojis={[{ key: "mc", url: "http://example.com/e.png" }]}
      />
    );
    const katex = root.querySelector(".katex");
    expect(katex).not.toBeNull();
    // 公式内部不得出现被注入的 mention/emoji 标记（MathML 里连普通 span 都不该有）
    expect(katex!.querySelector(".katex-mathml span")).toBeNull();
    expect(katex!.querySelector("img")).toBeNull();
    expect(katex!.querySelector(".mention-entity")).toBeNull();
    expect(katex!.querySelector(".wk-message-text-richemoji")).toBeNull();
    // 公式外的真实 mention 仍正常渲染（修复只跳过 .katex 子树，不影响正文分段）
    const mentionEls = Array.from(root.querySelectorAll(".mention-entity"));
    expect(mentionEls.length).toBe(1);
    expect(mentionEls[0].textContent).toBe("@小明");
    expect(katex!.contains(mentionEls[0])).toBe(false);
  });
});

describe("MarkdownContent — allowSingleDollarMath 关掉守卫 (文档/编辑器场景)", () => {
  it("开启后无数学字符的简单公式 $a+b$ 也渲染成 KaTeX", () => {
    // 默认路径下 $a+b$ 内部无 \\ ^ _ { }，会被守卫还原；文档场景显式关守卫应渲染。
    const root = renderContent(
      <MarkdownContent content={"值 $a+b$ 结束"} allowSingleDollarMath />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
  });

  it("默认路径下 $a+b$（无数学字符）按纯文本、不渲染公式", () => {
    const root = renderContent(<MarkdownContent content={"值 $a+b$ 结束"} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toBe("值 $a+b$ 结束");
  });

  it("enableMath={false} 时即便有 $$ 也不渲染公式", () => {
    const root = renderContent(
      <MarkdownContent content={"$$E=mc^2$$"} enableMath={false} />
    );
    expect(root.querySelector(".katex")).toBeNull();
  });
});
