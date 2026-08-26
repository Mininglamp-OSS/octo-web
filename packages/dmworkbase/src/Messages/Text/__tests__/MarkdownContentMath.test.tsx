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

describe("MarkdownContent — 被守卫拒绝的 $$ block 在容器内不泄漏容器标记 (Jerry-Xin blocker)", () => {
  it("blockquote 内被拒绝的 $$ block 还原时不带 `> ` continuation marker", () => {
    // 内部 "plain" 无数学字符 → 守卫拒绝。旧实现用 source.slice 还原会把 `> ` 一起切出来，
    // 显示成 `$$ / > plain / > $$`；修复后用 node.value 重拼，应还原用户原本的 `$$ / plain / $$`。
    const root = renderContent(
      <MarkdownContent content={"> $$\n> plain\n> $$"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("plain");
    expect(vt).toContain("$$");
    // 关键断言：不得把 blockquote 的 `>` 容器标记泄漏进正文
    expect(vt).not.toContain(">");
  });

  it("blockquote 内被拒绝的多行 $$ block 也不带容器标记", () => {
    const root = renderContent(
      <MarkdownContent content={"> $$\n> line one\n> line two\n> $$"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("line one");
    expect(vt).toContain("line two");
    expect(vt).not.toContain(">");
  });

  it("blockquote 内含数学字符的 $$ block 仍正常 KaTeX 渲染（被接受路径不受影响）", () => {
    const root = renderContent(
      <MarkdownContent content={"> $$\n> \\frac{a}{b}\n> $$"} />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
    expect(root.querySelector(".katex-display")).not.toBeNull();
  });

  it("顶层被拒绝的 $$ block 还原成文本、不渲染公式", () => {
    const root = renderContent(<MarkdownContent content={"$$\nplain\n$$"} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("plain");
  });
});

describe("MarkdownContent — 被拒绝的公式无损还原：不丢正文/meta、不泄漏容器标记 (reviewer P0/P1)", () => {
  // P0：开 fence 同行文本会被 remark-math 收进 node.meta，value 为空。旧实现只用 node.value
  // 重拼会渲染成空 `$$\n\n$$`，吞掉用户正文。新实现转义后重解析，正文原样保留。
  const p0Cases: string[] = [
    "$$100 too expensive",
    "$$ TODO: discuss tomorrow",
    "报价 $$100 有点贵",
  ];
  for (const input of p0Cases) {
    it(`开 fence 同行文本(meta)不被吞、原样显示：${JSON.stringify(input)}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      expect(visibleText(root)).toBe(input);
    });
  }

  it("blockquote 内无闭合 fence 的 `> $$cost estimate` 不渲染、不泄漏 `>`", () => {
    const root = renderContent(
      <MarkdownContent content={"> $$cost estimate"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("$$cost estimate");
    expect(vt).not.toContain(">");
  });

  it("P1：跨行 inline math 在 blockquote 内不把 `> ` 泄漏进正文", () => {
    // reviewer 例子：`> $foo` / `> bar$`，内部无数学字符 → 被拒。旧 slice 还原会显示
    // `$foo\n> bar$`，把容器 marker 漏进正文；新实现转义后重解析，remark 正确处理容器。
    const root = renderContent(
      <MarkdownContent content={"> $foo\n> bar$"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("$foo");
    expect(vt).toContain("bar$");
    expect(vt).not.toContain(">");
  });

  it("流式 `$$E=mc^2$$` 的中间前缀显示为文本、不空白闪烁，补全后渲染公式", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    // 中间前缀：未闭合，value 为空 → 按文本显示（不空白）
    act(() => {
      ReactDOM.render(
        <MarkdownContent content={"结果 $$E=mc^"} isStreaming />,
        container
      );
    });
    expect(container.querySelector(".katex")).toBeNull();
    expect(visibleText(container)).toContain("$$E=mc^");
    // 补全后：value 非空且含 ^ → 渲染 KaTeX
    act(() => {
      ReactDOM.render(
        <MarkdownContent content={"结果 $$E=mc^2$$"} isStreaming />,
        container
      );
    });
    expect(container.querySelector(".katex")).not.toBeNull();
  });

  it("同条消息里合法公式渲染、旁边的误匹配美元正文保持原样", () => {
    const root = renderContent(
      <MarkdownContent content={"公式 $x^2$ 花了 $$5 and $$10"} />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("花了 $$5 and $$10");
  });
});

describe("MarkdownContent — 含 _ \\ {} ^ 的 IM 正文仍不被吞 (reviewer P0)", () => {
  // 只看「两枚 $ 之间是否含某个 math-ish 字符」不够：snake_case / 路径 / JSON / 变量正文
  // 天然含 `_ \ {} ^`。收紧候选（Pandoc 邻接 + 不跨行 + 长度上限 + CJK）后这些正文必须保持原样。
  const sameLine: string[] = [
    "export $MY_VAR and $OTHER_VAR",
    "订单金额 $1,200，备注 order_id=88，退款 $300",
    "付了 $100，用了 snake_case 变量，又付 $200",
    "价格 $100，路径 C:\\tmp\\bin，另 $200",
    "预算 $500 见 a_b_c 实付 $600",
  ];
  for (const input of sameLine) {
    it(`同线正文不误渲染、$ 不丢：${JSON.stringify(input)}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      const vt = visibleText(root);
      // 每个美元金额都要原样保留（不能被吞掉分隔符）
      const dollars = input.match(/\$\d[\d,]*/g) ?? [];
      for (const d of dollars) expect(vt).toContain(d);
    });
  }

  it("ASCII-only 变量正文可见文本与输入完全一致", () => {
    const input = "export $MY_VAR and $OTHER_VAR";
    const root = renderContent(<MarkdownContent content={input} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toBe(input);
  });

  it("跨行正文不被吞成单个公式、三行不压成一行", () => {
    // reviewer 跨行复现：中间行含 my_var（_），旧规则会把 $100…my_var…$200 吞成一个 KaTeX run。
    const root = renderContent(
      <MarkdownContent content={"第一行 $100\n第二行 my_var\n第三行 $200"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("第一行");
    expect(vt).toContain("第二行");
    expect(vt).toContain("第三行");
    expect(vt).toContain("my_var");
    expect(vt).toContain("$100");
    expect(vt).toContain("$200");
  });

  it("超长（>200 字符）行内候选按正文处理，不吞进公式", () => {
    const longMid = "a_" + "x".repeat(250); // 含 _，但整体远超 200 字符上限
    const input = `$${longMid}$`;
    const root = renderContent(<MarkdownContent content={input} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("x".repeat(250));
  });
});

describe("MarkdownContent — 合法公式在收紧规则下仍渲染", () => {
  const ok: Array<[string, string]> = [
    ["单 $E=mc^2$", "值 $E=mc^2$ 结束"],
    ["单 $x_1$", "设 $x_1$"],
    ["内部带空格 $a + b^2$", "式 $a + b^2$ 完"],
    ["行内 $$ \\eta_{avg} $$（双美元允许 padding）", "结果 $$ \\eta_{avg} $$ 完"],
  ];
  for (const [name, content] of ok) {
    it(`仍渲染：${name}`, () => {
      const root = renderContent(<MarkdownContent content={content} />);
      expect(root.querySelector(".katex")).not.toBeNull();
    });
  }
});

describe("MarkdownContent — KaTeX 解析失败回落为正文，不显示 .katex-error 红字", () => {
  it("无效公式被判为公式但解析失败时，降级为纯文本（保留定界符、不显示红字）", () => {
    // `$\frac{a}$` 过守卫（含 \ 和 {}，单 $ 两端紧贴非空白），但缺第二个参数 → KaTeX 报错。
    // 预校验失败 → 整体按字面文本保留，连 `$` 定界符一起（P1-1：旧 fallback 会丢定界符）。
    const root = renderContent(<MarkdownContent content={"试 $\\frac{a}$ 完"} />);
    expect(root.querySelector(".katex-error")).toBeNull();
    expect(visibleText(root)).toContain("$\\frac{a}$");
  });

  it("合法公式不受 error 回落插件影响，正常渲染", () => {
    const root = renderContent(<MarkdownContent content={"$\\frac{a}{b}$"} />);
    expect(root.querySelector(".katex")).not.toBeNull();
    expect(root.querySelector(".katex-error")).toBeNull();
  });
});

describe("MarkdownContent — inline $$ 与无空格 shell/path prose 不被吞 (reviewer Gap A/B)", () => {
  // Gap A：inline $$…$$ 也要受候选约束（英文正文没有 CJK 兜底）。
  const gapA: string[] = [
    "paid $$100 for my_var then $$200",
    "cost $$5 for a_b and $$10",
  ];
  for (const input of gapA) {
    it(`inline $$ 英文正文不误渲染：${JSON.stringify(input)}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      const vt = visibleText(root);
      for (const n of input.match(/\d+/g) ?? []) expect(vt).toContain(n);
    });
  }

  it("inline $$ 英文正文保留中间词（不吞成 100formyvarthen200）", () => {
    const root = renderContent(
      <MarkdownContent content={"paid $$100 for my_var then $$200"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("for my_var then");
    expect(vt).toContain("100");
    expect(vt).toContain("200");
  });

  // Gap B：无空格的 shell/env/path 正文（首尾字符紧贴非空白，但内容形态明显是正文）。
  const gapB: Array<[string, string[]]> = [
    ["$HOME_DIR/$SUB_DIR", ["HOME_DIR", "SUB_DIR"]],
    ["$FOO_BAR/$BAZ_QUX", ["FOO_BAR", "BAZ_QUX"]],
    ["use $PATH_A:$PATH_B now", ["PATH_A", "PATH_B"]],
    ["ratio $1_000/$2_000 ok", ["1_000", "2_000"]],
    ["C:\\a$X_1\\b$Y_2", ["X_1", "Y_2"]],
  ];
  for (const [input, tokens] of gapB) {
    it(`无空格 shell/path 正文不误渲染：${JSON.stringify(input)}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      const vt = visibleText(root);
      for (const tk of tokens) expect(vt).toContain(tk);
    });
  }
});

describe("MarkdownContent — 含真正 TeX 命令时放宽（CJK 合法公式仍渲染）", () => {
  it("$v_{\\text{平均}}$（含 \\text 命令）照常渲染成 KaTeX", () => {
    const root = renderContent(
      <MarkdownContent content={"速度 $v_{\\text{平均}}$ 是关键"} />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
  });

  it("纯 CJK 且无命令的 $金额_x$ 不渲染（视为正文）", () => {
    const root = renderContent(<MarkdownContent content={"订单 $金额_x$ 备注"} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("金额_x");
  });
});

describe("MarkdownContent — shell/CI/模板插值 ${VAR} 不被当公式 (reviewer P0-1)", () => {
  const cases: string[] = [
    "${VAR}",
    "${A}+${B}",
    "${VERSION}-${BUILD}",
    "export ${HOME} then ${PATH}",
    "run ${CI_COMMIT_SHA} now",
  ];
  for (const input of cases) {
    it(`不误渲染且原样保留：${JSON.stringify(input)}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      const vt = visibleText(root);
      expect(vt).toBe(input);
      // 连字符不能被 KaTeX 变成 U+2212 减号
      expect(vt).not.toContain("−");
    });
  }
});

describe("MarkdownContent — 价格+公式混排：货币不吃掉后面公式的定界符 (reviewer P1-2)", () => {
  it("costs $100 and then $E=mc^2$ 里的公式仍渲染，货币原样", () => {
    const root = renderContent(
      <MarkdownContent content={"costs $100 and then $E=mc^2$"} />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
    expect(visibleText(root)).toContain("costs $100 and then");
  });

  it("报价 $100，公式 $x^2$ 同时成立", () => {
    const root = renderContent(
      <MarkdownContent content={"报价 $100，公式 $x^2$"} />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
    expect(visibleText(root)).toContain("$100");
  });
});

describe("MarkdownContent — 段落里预先转义的 \\$ 不破坏其它 $ 的保护 (reviewer P1-3)", () => {
  it("pay $100 and \\$200 ok 不丢 $、不留异常反斜杠、不渲染公式", () => {
    const root = renderContent(
      <MarkdownContent content={"pay $100 and \\$200 ok"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("$100");
    expect(vt).toContain("$200");
    expect(vt).not.toContain("\\");
  });
});

describe("MarkdownContent — 超长 $$ block 超限回退为文本 (reviewer P2-8)", () => {
  it("约 4.8KB 的 display math 超过长度上限时按文本处理，不渲染", () => {
    const body = "x_1 + " + "a".repeat(4800); // 含 math-ish，但整体 > 4096
    const root = renderContent(<MarkdownContent content={`$$\n${body}\n$$`} />);
    expect(root.querySelector(".katex")).toBeNull();
  });

  it("正常长度的 display math 仍渲染", () => {
    const root = renderContent(
      <MarkdownContent content={"$$\n\\frac{a}{b}\n$$"} />
    );
    expect(root.querySelector(".katex-display")).not.toBeNull();
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
