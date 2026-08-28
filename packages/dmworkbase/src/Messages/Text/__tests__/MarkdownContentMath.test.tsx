// @vitest-environment jsdom
//
// WS-117 / GH#1089 — Web 端消息里的 LaTeX 公式必须渲染（iOS 已渲染，只要一端渲染
// 所有端都渲染），同时不能腐蚀普通 IM 正文（货币 / shell / 路径 / ${VAR} / JSON / 中文）。
//
// 架构（聊天默认路径，enableMath 默认 true）：不使用 remark-math 的贪婪配对，改为自研单次
// 左到右扫描器直接在 mdast 文本节点上识别公式，所有进入 KaTeX 的 route（行内 $、行内/块级
// $$、```math 围栏）统一过同一套 guard 与上限：
//   1. 正向 TeX 白名单（多字母命令 / 上标 / 单字符底下标）+ 负向 shell/path/prose 信号
//      （${…}、/ :、单字母反斜杠、定界符紧贴单词字符、跨软换行非锚定 $$、无命令的 CJK / ≥2 词形 token）。
//   2. 转义在解析前稳定保存：escapeMaskPlugin 用「源码/AST 中不存在且保持 CommonMark 标点分类的
//      动态 Unicode 哨兵」遮罩公式候选内会被解码的反斜杠转义；公式恢复原始 TeX，正文保持原生结构。
//   3. KaTeX 预校验 + 接收端上限：解析失败整条按字面保留（含定界符、无红字）；渲染后 HTML >60KB、
//      单条消息累计 HTML >120KB 或公式数 >32 拒绝（$ / $$ / ```math 共享同一 per-render 上下文）。
//   4. 依赖对齐 remark-math ^6→^5（仅 allowSingleDollarMath 文档/编辑器路径使用）；渲染顺序
//      highlight → sanitize → fence-guard → katex；trust:false / maxSize:10 / maxExpand:100。
// 文档/编辑器等要「无守卫、简单 $a+b$ 也渲染」的场景可显式传 allowSingleDollarMath。

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import katex from "katex";
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

function texAnnotations(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll('annotation[encoding="application/x-tex"]')
  ).map((node) => node.textContent ?? "");
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
    const root = renderContent(
      <MarkdownContent content={"值 $E=mc^2$ 结束"} />
    );
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
    const root = renderContent(
      <MarkdownContent content={"$$\\frac{a}{b}$$"} />
    );
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

  const lineEndingMatrix: Array<[string, string]> = [
    ["LF / EOF", "$$\n\\frac{a}{b}\n$$"],
    ["LF / 后续文本", "$$\n\\frac{a}{b}\n$$\ntail"],
    ["LF / 空行后续文本", "$$\n\\frac{a}{b}\n$$\n\ntail"],
    ["CRLF / EOF", "$$\r\n\\frac{a}{b}\r\n$$"],
    ["CRLF / 后续文本", "$$\r\n\\frac{a}{b}\r\n$$\r\ntail"],
    ["CRLF / 空行后续文本", "$$\r\n\\frac{a}{b}\r\n$$\r\n\r\ntail"],
  ];
  for (const [name, content] of lineEndingMatrix) {
    it(`行尾矩阵 ${name}：锚定 display 公式正常渲染`, () => {
      const root = renderContent(<MarkdownContent content={content} />);
      expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
      if (content.includes("tail")) expect(visibleText(root)).toContain("tail");
    });
  }

  it("独占一行的 $$\\frac{a}{b}$$ 使用 display 模式", () => {
    const root = renderContent(
      <MarkdownContent content={"$$\\frac{a}{b}$$"} />
    );
    expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
  });

  it("显式 display 即使没有 math-ish 字符也渲染", () => {
    const root = renderContent(
      <MarkdownContent content={"$$\na + b = c\n$$"} />
    );
    expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
  });

  it("正文中的 $$E=mc^2$$ 仍保持 inline 模式", () => {
    const root = renderContent(
      <MarkdownContent content={"text $$E=mc^2$$ text"} />
    );
    expect(root.querySelectorAll(".katex")).toHaveLength(1);
    expect(root.querySelector(".katex-display")).toBeNull();
  });

  it("源码行内 markup 后的 $$ 不把 text-node 边界误判为行首", () => {
    const input = "**Prefix**$$\nx^2\n$$";
    const root = renderContent(<MarkdownContent content={input} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("$$");
  });

  it("源码行内 markup 前的 $$ 不把 text-node 边界误判为行尾", () => {
    const input = "$$\nx^2\n$$**suffix**";
    const root = renderContent(<MarkdownContent content={input} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("$$");
  });

  it("深层 blockquote 的非锚定 $$ 线性判定，不发生正则指数回溯", () => {
    const prefix = "> ".repeat(40);
    const input = [prefix + "x $$", prefix + "foo", prefix + "$$"].join("\n");
    const startedAt = performance.now();
    const root = renderContent(<MarkdownContent content={input} />);
    const elapsedMs = performance.now() - startedAt;

    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("x $$");
    expect(elapsedMs).toBeLessThan(500);
  });

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
    const root = renderContent(
      <MarkdownContent content={"$$\\frac{a}{b}$$"} />
    );
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
    // 无效命令被 KaTeX 拒绝。旧实现用 source.slice 还原会把 `> ` 一起切出来；
    // 修复后按节点语义重拼，应还原用户原本的 `$$ / \bad / $$`。
    const root = renderContent(
      <MarkdownContent content={"> $$\n> \\bad\n> $$"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("\\bad");
    expect(vt).toContain("$$");
    // 关键断言：不得把 blockquote 的 `>` 容器标记泄漏进正文
    expect(vt).not.toContain(">");
  });

  it("blockquote 内被拒绝的多行 $$ block 也不带容器标记", () => {
    const root = renderContent(
      <MarkdownContent content={"> $$\n> \\bad\n> \\worse\n> $$"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("\\bad");
    expect(vt).toContain("\\worse");
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
    const root = renderContent(<MarkdownContent content={"$$\n\\bad\n$$"} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("\\bad");
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
    it(`开 fence 同行文本(meta)不被吞、原样显示：${JSON.stringify(
      input
    )}`, () => {
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
    const root = renderContent(<MarkdownContent content={"> $foo\n> bar$"} />);
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
    [
      "行内 $$ \\eta_{avg} $$（双美元允许 padding）",
      "结果 $$ \\eta_{avg} $$ 完",
    ],
  ];
  for (const [name, content] of ok) {
    it(`仍渲染：${name}`, () => {
      const root = renderContent(<MarkdownContent content={content} />);
      expect(root.querySelector(".katex")).not.toBeNull();
    });
  }
});

describe("MarkdownContent — CommonMark 转义不篡改交给 KaTeX 的 TeX", () => {
  const inlineCases: Array<[string, string]> = [
    ["百分号", "$50\\% \\times x^2$"],
    ["集合括号", "$\\{x \\mid x^2>1\\}$"],
    ["文本下划线", "$\\text{a\\_b}^2$"],
    ["井号与括号", "$\\#\\{S\\}^2$"],
    ["细空格", "$3\\,x^2$"],
    ["公式内美元", "$\\$5 = x^2$"],
    ["文本与号", "$\\text{A\\&B}^2$"],
  ];

  for (const [name, input] of inlineCases) {
    it(`${name} 保留作者原始转义`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelectorAll(".katex")).toHaveLength(1);
      expect(texAnnotations(root)).toContain(input.slice(1, -1));
    });
  }

  const afterRejectedDollarCases: Array<[string, string, string]> = [
    ["订单 $12 的折扣是 $50\\% \\times x^2$", "$12", "50\\% \\times x^2"],
    ["预算 $200，公式 $a\\_b^2$ 请看", "$200", "a\\_b^2"],
  ];

  for (const [input, literalPrefix, tex] of afterRejectedDollarCases) {
    it(`前导金额不破坏后续公式转义：${input}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelectorAll(".katex")).toHaveLength(1);
      expect(texAnnotations(root)).toContain(tex);
      expect(visibleText(root)).toContain(literalPrefix);
    });
  }

  const displayCases: Array<[string, string]> = [
    ["aligned", "\\begin{aligned}x &= 1\\\\y &= 2\\end{aligned}"],
    ["pmatrix", "\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}"],
    ["cases", "f(x)=\\begin{cases}1 & x>0\\\\0 & x\\le 0\\end{cases}"],
    ["array", "\\begin{array}{c}a\\\\b\\end{array}"],
  ];

  for (const [name, tex] of displayCases) {
    it(`${name} 多行环境保留双反斜杠并渲染`, () => {
      const root = renderContent(
        <MarkdownContent content={`$$\n${tex}\n$$`} />
      );
      expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
      expect(texAnnotations(root)).toContain(`\n${tex}\n`);
    });
  }
});

describe("MarkdownContent — KaTeX 解析失败回落为正文，不显示 .katex-error 红字", () => {
  it("无效公式被判为公式但解析失败时，降级为纯文本（保留定界符、不显示红字）", () => {
    // `$\frac{a}$` 过守卫（含 \ 和 {}，单 $ 两端紧贴非空白），但缺第二个参数 → KaTeX 报错。
    // 预校验失败 → 整体按字面文本保留，连 `$` 定界符一起（P1-1：旧 fallback 会丢定界符）。
    const root = renderContent(
      <MarkdownContent content={"试 $\\frac{a}$ 完"} />
    );
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
    const root = renderContent(
      <MarkdownContent content={"订单 $金额_x$ 备注"} />
    );
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
    const renderToString = vi.spyOn(katex, "renderToString");
    try {
      const root = renderContent(
        <MarkdownContent content={`$$\n${body}\n$$`} />
      );
      expect(root.querySelector(".katex")).toBeNull();
      expect(renderToString).not.toHaveBeenCalled();
    } finally {
      renderToString.mockRestore();
    }
  });

  it("正常长度的 display math 仍渲染", () => {
    const root = renderContent(
      <MarkdownContent content={"$$\n\\frac{a}{b}\n$$"} />
    );
    expect(root.querySelector(".katex-display")).not.toBeNull();
  });

  it("8 行嵌套分式的 aligned 推导不被行内复杂度预算误拒绝", () => {
    const lines = Array.from(
      { length: 7 },
      (_, index) =>
        `\\frac{\\frac{a_${index}}{b_${index}}}{\\frac{c_${index}}{d_${index}}} &= \\frac{e_${index}}{f_${index}}`
    );
    lines.push("\\frac{a_7}{b_7} &= c_7");
    const body = `\\begin{aligned}\n${lines.join("\\\\\n")}\n\\end{aligned}`;
    expect(body.length).toBeGreaterThan(450);
    const root = renderContent(<MarkdownContent content={`$$\n${body}\n$$`} />);
    expect(root.querySelector(".katex-display")).not.toBeNull();
  });
});

describe("MarkdownContent — 跨软换行的非锚定 $$ 不吞成 display math (reviewer P0-1)", () => {
  const cases: Array<[string, string[]]> = [
    ["cost $$5 for\nmy_var is $$10", ["5 for", "my_var is", "$$"]],
    ["note $$a for\nfoo bar $$b end", ["a for", "foo bar", "$$"]],
  ];
  for (const [input, tokens] of cases) {
    it(`非行首/行尾锚定的 $$ 按文本处理：${JSON.stringify(input)}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      const vt = visibleText(root);
      for (const tk of tokens) expect(vt).toContain(tk);
    });
  }

  it("真正行锚定的 $$ block 仍渲染成 display", () => {
    const root = renderContent(
      <MarkdownContent content={"$$\n\\frac{a}{b}\n$$"} />
    );
    expect(root.querySelector(".katex-display")).not.toBeNull();
  });
});

describe("MarkdownContent — 多个 $$ 候选的源码映射保持同步 (review round 11)", () => {
  it("被拒绝的 inline $$ 后续跨行正文不误渲染为 display", () => {
    const input = "$$x$$\nthe config_x value $$100 and\nmore$$";
    const root = renderContent(<MarkdownContent content={input} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("the config_x value");
    expect(visibleText(root)).toContain("$$100 and");
  });

  it("被拒绝的 inline $$ 后续中文正文不误渲染为 display", () => {
    const input = "$$x$$\n这里 m_0 是质量 $$100 and\nmore$$";
    const root = renderContent(<MarkdownContent content={input} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("这里 m_0 是质量");
  });

  it("已接受的 inline $$ 后续合法 display 仍正常渲染", () => {
    const root = renderContent(
      <MarkdownContent content={"$$a^2$$ then\n$$\nE=mc^2\n$$"} />
    );
    expect(root.querySelectorAll(".katex")).toHaveLength(2);
    expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
  });

  it("跨行正文候选之后的合法 display 不会因游标滞后而漏渲", () => {
    const root = renderContent(
      <MarkdownContent content={"cost $$5 for\nthe item $$ x\n$$\ny^2\n$$"} />
    );
    expect(root.querySelectorAll(".katex")).toHaveLength(1);
    expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(visibleText(root)).toContain("cost $$5 for");
  });

  it("行中非锚定候选之后的合法 display 不会因游标滞后而漏渲", () => {
    const root = renderContent(
      <MarkdownContent content={"prefix$$\na\n$$ then\n$$\nx^2\n$$"} />
    );
    expect(root.querySelectorAll(".katex")).toHaveLength(1);
    expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(visibleText(root)).toContain("prefix$$");
  });

  it("无源码 position 的 HTML 文本节点不猜测 display 锚点", () => {
    const root = renderContent(
      <MarkdownContent content={"$$\na^2\n$$\n\n<div>pre$$\nx^2\n$$</div>"} />
    );
    expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(visibleText(root)).toContain("pre$$");
  });
});

describe("MarkdownContent — 被拒绝的单行 $$ 不让 text/source 游标错位", () => {
  const literalCases = [
    "> pay $$5 or $$ my_var here\n> $$\n> x^2\n> $$",
    "a \\* b $$5 or $$ my_var here\n$$\nx^2\n$$",
    "a &amp; b $$5 or $$ my_var here\n$$\nx^2\n$$",
  ];

  for (const input of literalCases) {
    it(`正文保持字面且后续 display 正常渲染：${JSON.stringify(input)}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
      expect(visibleText(root)).toContain("$$5 or $$ my_var here");
    });
  }

  it("inline code 中的 $$ 不影响同一 blockquote 后续 display", () => {
    const root = renderContent(
      <MarkdownContent content={"> `$$` and $$ y_1 more\n> $$\n> x^2\n> $$"} />
    );
    expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(visibleText(root)).toContain("$$ y_1 more");
  });

  it("opener 同行含公式内容的既有多行 display 仍可渲染", () => {
    const root = renderContent(<MarkdownContent content={"$$ x^2\ny^2\n$$"} />);
    expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
  });

  it("非精确映射节点中的单 $ 公式不干扰后续 display", () => {
    const root = renderContent(
      <MarkdownContent content={"> $x^2$ then\n> $$\n> y^2\n> $$"} />
    );
    expect(root.querySelectorAll(".katex")).toHaveLength(2);
    expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
  });
});

describe("MarkdownContent — 被拒绝的 display 不复用 closer (review round 11)", () => {
  const cases = [
    "$$\n\\frac{a}{b\n$$\n其中 a_1 为系数\n$$\nc^2\n$$",
    "$$\n\\label{a}\n$$\n下面是 m_0 静质量\n$$\ny^2\n$$",
    "$$\n\\label{a}\n$$\nnote a_1 here\n$$\ny^2\n$$",
    "> $$\n> \\bad\n> $$\n> some ^text\n> $$\n> y^2\n> $$",
  ];

  for (const input of cases) {
    it(`保留无效块及其中间正文，仅渲染下一合法块：${JSON.stringify(
      input
    )}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
    });
  }

  it("无效块后的 ASCII 正文不会被 KaTeX 吞掉", () => {
    const root = renderContent(
      <MarkdownContent
        content={"$$\n\\label{a}\n$$\nnote a_1 here\n$$\ny^2\n$$"}
      />
    );
    expect(visibleText(root)).toContain("note a_1 here");
    expect(visibleText(root)).toContain("\\label{a}");
  });

  it("首个 display 合法时两个公式都渲染且中间正文完整", () => {
    const root = renderContent(
      <MarkdownContent content={"$$\nx^2\n$$\nnote a_1 here\n$$\ny^2\n$$"} />
    );
    expect(root.querySelectorAll(".katex-display")).toHaveLength(2);
    expect(visibleText(root)).toContain("note a_1 here");
  });
});

describe("MarkdownContent — display 配对在容器与换行组合下保持稳定", () => {
  const matrix = ["LF", "CRLF"].flatMap((lineEnding) =>
    ["paragraph", "blockquote"].flatMap((containerKind) =>
      ["valid", "invalid"].flatMap((firstBlockKind) =>
        ["adjacent", "blank-line"].map((separation) => ({
          lineEnding,
          containerKind,
          firstBlockKind,
          separation,
        }))
      )
    )
  );

  for (const {
    lineEnding,
    containerKind,
    firstBlockKind,
    separation,
  } of matrix) {
    it(`${lineEnding} / ${containerKind} / ${firstBlockKind} / ${separation}`, () => {
      const eol = lineEnding === "CRLF" ? "\r\n" : "\n";
      const gap = separation === "blank-line" ? [""] : [];
      const lines = [
        "$$",
        firstBlockKind === "valid" ? "x^2" : "\\label{a}",
        "$$",
        ...gap,
        "note a_1 here",
        "$$",
        "y^2",
        "$$",
      ];
      const content =
        containerKind === "blockquote"
          ? lines.map((line) => (line ? `> ${line}` : "> ")).join(eol)
          : lines.join(eol);
      const root = renderContent(<MarkdownContent content={content} />);

      expect(root.querySelectorAll(".katex-display")).toHaveLength(
        firstBlockKind === "valid" ? 2 : 1
      );
      expect(visibleText(root)).toContain("note a_1 here");
    });
  }

  const reusedDisplayOpenerCases: Array<[string, string, string]> = [
    [
      "cost $$5 for\n$$\n\\alpha \\% \\beta + \\gamma^2\n$$",
      "\\alpha \\% \\beta + \\gamma^2",
      "β",
    ],
    ["cost $$5 for\n$$\na\\_b^2\n$$", "a\\_b^2", "a"],
  ];

  for (const [content, tex, visibleToken] of reusedDisplayOpenerCases) {
    it(`复用 closer 作为 display opener 时保留块内转义：${tex}`, () => {
      const root = renderContent(<MarkdownContent content={content} />);
      expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
      expect(texAnnotations(root).some((value) => value.includes(tex))).toBe(
        true
      );
      expect(visibleText(root)).toContain(visibleToken);
    });
  }
});

describe("MarkdownContent — markdown 转义的 \\$ 保持 literal，不被重新激活为定界符 (reviewer P0-2)", () => {
  it("literal \\$x_1\\$ 原样显示，不渲染公式", () => {
    const root = renderContent(
      <MarkdownContent content={"literal \\$x_1\\$ end"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("$x_1$");
  });

  it("一端转义 \\$ 时另一端普通 $ 不被错误配对", () => {
    const root = renderContent(
      <MarkdownContent content={"pay \\$5 then $x^2$ ok"} />
    );
    // 转义的 \$5 保持 literal，真正的 $x^2$ 仍渲染
    expect(root.querySelector(".katex")).not.toBeNull();
    expect(visibleText(root)).toContain("$5");
  });
});

describe("MarkdownContent — 短 shell/env 变量不被当行内公式 (reviewer P1-1)", () => {
  const cases: string[] = [
    "echo $X_1,$Y_2",
    "echo $A_1+$B_2",
    "vars $a_1;$b_2 end",
  ];
  for (const input of cases) {
    it(`不误渲染且 $ 保留：${JSON.stringify(input)}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      const vt = visibleText(root);
      for (const v of input.match(/\$[A-Za-z]_?\d?/g) ?? []) {
        expect(vt).toContain(v);
      }
    });
  }

  it("真正的单变量下标 $x_1$（两侧非单词字符）仍渲染", () => {
    const root = renderContent(<MarkdownContent content={"设 $x_1$ 为初值"} />);
    expect(root.querySelector(".katex")).not.toBeNull();
  });
});

describe("MarkdownContent — 接收端保护：每条消息公式数量上限 (reviewer P1-2)", () => {
  it("一条消息里 40 个公式最多渲染 32 个，其余按文本", () => {
    const input = Array.from({ length: 40 }, () => "$x^2$").join(" ");
    const root = renderContent(<MarkdownContent content={input} />);
    expect(root.querySelectorAll(".katex").length).toBe(32);
  });

  it("输入合法但渲染产物过大的公式按文本处理（渲染后 HTML 上限）", () => {
    // 约 400 字符且复杂度很低，但 KaTeX 渲染产物超过 60KB。
    const body = "x^2+".repeat(100) + "x";
    const renderToString = vi.spyOn(katex, "renderToString");
    try {
      const root = renderContent(
        <MarkdownContent content={`$$\n${body}\n$$`} />
      );
      expect(root.querySelector(".katex")).toBeNull();
      expect(renderToString).toHaveBeenCalled();
    } finally {
      renderToString.mockRestore();
    }
  });

  it("多公式共享累计渲染预算，不能叠加成超大 DOM", () => {
    const row = Array.from({ length: 20 }, () => "x").join(" & ");
    const matrix = `\\begin{pmatrix}${row}\\\\${row}\\\\${row}\\end{pmatrix}`;
    const input = Array.from({ length: 8 }, () => `$$\n${matrix}\n$$`).join(
      "\n\n"
    );
    const root = renderContent(<MarkdownContent content={input} />);
    const rendered = root.querySelectorAll(".katex-display").length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(8);
  });

  it("高复杂度公式在调用 KaTeX 前快速拒绝", () => {
    const denseEscapes = "\\{\\}".repeat(200);
    const input = Array.from(
      { length: 32 },
      () => `$$\n${denseEscapes}\n$$`
    ).join("\n\n");
    const renderToString = vi.spyOn(katex, "renderToString");
    try {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      expect(renderToString).not.toHaveBeenCalled();
    } finally {
      renderToString.mockRestore();
    }
  });

  it("宏定义膨胀在调用 KaTeX 前快速拒绝", () => {
    const macroBody = "x".repeat(1400);
    const body = `\\def\\a{${macroBody}}${"\\a".repeat(78)}`;
    const renderToString = vi.spyOn(katex, "renderToString");
    try {
      const root = renderContent(
        <MarkdownContent content={`$$\n${body}\n$$`} />
      );
      expect(root.querySelector(".katex")).toBeNull();
      expect(visibleText(root)).toContain("\\def\\a");
      expect(renderToString).not.toHaveBeenCalled();
    } finally {
      renderToString.mockRestore();
    }
  });

  it("单条公式超出输出上限时，后续小公式仍可渲染", () => {
    const oversized = "+".repeat(1400);
    const input = `$$\n${oversized}\n$$\n\n$$\\frac{a}{b}$$\n\n$$\\frac{c}{d}$$`;
    const root = renderContent(<MarkdownContent content={input} />);
    expect(root.querySelectorAll(".katex-display")).toHaveLength(2);
    expect(visibleText(root)).toContain(oversized);
  });

  it("公式 attempt 达到 32 后停止预校验，失败候选也计入上限", () => {
    const invalid = Array.from({ length: 32 }, () => "$\\frac{a}$").join(" ");
    const root = renderContent(
      <MarkdownContent content={`${invalid} $x^2$`} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("$x^2$");
  });
});

describe("MarkdownContent — 转义保护不改变公式外 Markdown 结构", () => {
  const emphasisCases = ["*\\!*a", "a*\\_*b", "**\\!**a"];
  for (const input of emphasisCases) {
    it(`强调结构与关闭数学时一致：${input}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      const mathHtml = root.innerHTML;
      act(() => {
        ReactDOM.render(
          <MarkdownContent content={input} enableMath={false} />,
          root
        );
      });
      expect(mathHtml).toBe(root.innerHTML);
    });
  }

  const linkCases = [
    "see https://e.com/a\\_b\\_c now",
    "见 https://e.com/q?a=1\\&b=2 完",
    "<https://example.com/a\\-b>",
  ];
  for (const input of linkCases) {
    it(`自动链接地址与关闭数学时一致：${input}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      const mathHref = root.querySelector("a")?.getAttribute("href");
      act(() => {
        ReactDOM.render(
          <MarkdownContent content={input} enableMath={false} />,
          root
        );
      });
      expect(mathHref).toBe(root.querySelector("a")?.getAttribute("href"));
    });
  }

  it("潜在公式跨过 reference link 时，不破坏转义 identifier 的链接解析", () => {
    const input = "$foo [text][a\\!b] x^2$\n\n[a\\!b]: https://example.com";
    const root = renderContent(<MarkdownContent content={input} />);
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com"
    );
    expect(root.querySelector("a")?.textContent).toBe("text");
  });

  it("字符实体美元不借用后续真实 $$ 的源码位置", () => {
    const input = "&#36;&#36;x^2&#36;&#36;\n$$\ny^2\n$$";
    const root = renderContent(<MarkdownContent content={input} />);
    expect(root.querySelectorAll(".katex-display")).toHaveLength(1);
    expect(texAnnotations(root)).toContain("y^2\n");
    expect(visibleText(root)).toContain("$$x^2$$");
  });
});

describe("MarkdownContent — JSON quoted values 不误判为公式", () => {
  const cases = [
    '{"key":"$x_1$"}',
    '{"a":"$x^2$","b":2}',
    'JSON: {"key":"$x_1$"}',
    '["$x^2$"]',
    '{"meta":"}","values":["$x^2$"]}',
    `don't render {"key":"$x^2$"}`,
    "{'key':'$x^2$'}",
  ];
  for (const input of cases) {
    it(`保持字面 JSON：${input}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      expect(visibleText(root)).toBe(input);
    });
  }

  it("普通引号中的显式公式仍可渲染", () => {
    const root = renderContent(
      <MarkdownContent content={'the formula is "$x^2$"'} />
    );
    expect(root.querySelectorAll(".katex")).toHaveLength(1);
  });

  it("大量引号候选的扫描耗时按输入长度近似线性增长", () => {
    const measure = (repetitions: number) => {
      const startedAt = performance.now();
      renderContent(<MarkdownContent content={'"$a$"'.repeat(repetitions)} />);
      const elapsed = performance.now() - startedAt;
      if (container) {
        ReactDOM.unmountComponentAtNode(container);
        container.remove();
        container = null;
      }
      return elapsed;
    };

    measure(200);
    const small = measure(4_000);
    const large = measure(16_000);
    expect(large / Math.max(small, 1)).toBeLessThan(10);
  });
});

describe("MarkdownContent — 显式 display 仍拒绝纯 prose", () => {
  const cases = [
    "$$ not math $$",
    "$$\nTODO: 明天讨论\n$$",
    "$$\n这是我的报价\n$$",
  ];
  for (const input of cases) {
    it(`不把正文压成数学文本：${JSON.stringify(input)}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      expect(visibleText(root)).toBe(input);
    });
  }
});

describe("MarkdownContent — trust-gated KaTeX 命令整体回退", () => {
  const cases = [
    "$\\href{javascript:alert(1)}{click}$",
    "$\\htmlClass{foo}{click}$",
    "$\\htmlData{key=value}{click}$",
  ];
  for (const input of cases) {
    it(`保留命令及全部参数：${input}`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      expect(visibleText(root)).toBe(input);
    });
  }
});

describe("MarkdownContent — 转义 \\$ 在容器/实体等场景仍保持 literal (reviewer P0-2 收口)", () => {
  const cases: Array<[string, string]> = [
    ["blockquote 多行续行内转义", "> pre line\n> literal \\$x_1\\$ here"],
    ["list item 多行续行内转义", "- pre line\n  literal \\$x_1\\$ done"],
    ["含实体的行内转义", "a &amp; \\$x_1\\$ b"],
    ["多段落其一含转义", "para one\n\npay \\$x_1\\$ ok"],
  ];
  for (const [name, input] of cases) {
    it(`${name}：\\$…\\$ 不被重新激活为定界符`, () => {
      const root = renderContent(<MarkdownContent content={input} />);
      expect(root.querySelector(".katex")).toBeNull();
      expect(visibleText(root)).toContain("$x_1$");
    });
  }

  it("转义 \\$ 与真实反斜杠 \\\\$x^2$ 区分：字面反斜杠后是活公式", () => {
    // \\$x^2$ = 字面反斜杠 + 活公式：应渲染公式，且保留一个反斜杠
    const root = renderContent(
      <MarkdownContent content={"path \\\\$x^2$ end"} />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
  });
});

describe("MarkdownContent — ```math 围栏与 $$ 走同一套上限 (reviewer P0-2/fence 收口)", () => {
  it("合法 ```math 围栏渲染成 KaTeX", () => {
    const root = renderContent(
      <MarkdownContent content={"```math\n\\frac{a}{b}\n```"} />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
  });

  it("超大 ```math 围栏超过渲染产物上限时退回代码块，不进 KaTeX", () => {
    const body = "\\begin{matrix}" + "1 & ".repeat(900) + "1\\end{matrix}";
    const root = renderContent(
      <MarkdownContent content={"```math\n" + body + "\n```"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
  });

  it("超长 ```math 围栏（超过块长上限）退回代码块", () => {
    const body = "x_1 " + "a".repeat(4500);
    const renderToString = vi.spyOn(katex, "renderToString");
    try {
      const root = renderContent(
        <MarkdownContent content={"```math\n" + body + "\n```"} />
      );
      expect(root.querySelector(".katex")).toBeNull();
      expect(renderToString).not.toHaveBeenCalled();
    } finally {
      renderToString.mockRestore();
    }
  });
});

describe("MarkdownContent — ```math 围栏计入每条消息公式上限 (reviewer P1-1)", () => {
  it("40 个 ```math 围栏最多渲染 32 个，其余退回代码块", () => {
    const input = Array.from({ length: 40 }, () => "```math\nx^2\n```").join(
      "\n\n"
    );
    const root = renderContent(<MarkdownContent content={input} />);
    expect(root.querySelectorAll(".katex").length).toBe(32);
  });

  it("$ 公式与 ```math 围栏共享同一计数（合计不超 32）", () => {
    const inline = Array.from({ length: 20 }, () => "$x^2$").join(" ");
    const fences = Array.from({ length: 20 }, () => "```math\nx^2\n```").join(
      "\n\n"
    );
    const root = renderContent(
      <MarkdownContent content={inline + "\n\n" + fences} />
    );
    expect(root.querySelectorAll(".katex").length).toBe(32);
  });
});

describe("MarkdownContent — escape 哨兵不泄漏到 link/image 属性 (reviewer P1-2)", () => {
  it("链接目标里的 \\$ 还原成字面 $，不留哨兵/百分号编码", () => {
    const root = renderContent(
      <MarkdownContent content={"[go](https://example.com/a\\$b)"} />
    );
    const a = root.querySelector("a");
    const href = a?.getAttribute("href") ?? "";
    expect(href).toContain("a$b");
    expect(href).not.toContain("");
    expect(href).not.toContain("%EE%80%80");
  });

  it("图片 src 与 alt 里的 \\$ 还原成字面 $", () => {
    const root = renderContent(
      <MarkdownContent content={"![pic \\$x](https://ex.com/i\\$m.png)"} />
    );
    const img = root.querySelector("img");
    expect(img?.getAttribute("src") ?? "").toContain("i$m.png");
    expect(img?.getAttribute("src") ?? "").not.toContain("");
    expect(img?.getAttribute("alt") ?? "").toContain("$x");
  });
});

describe("MarkdownContent — 用户原文里的 U+E000 不被无条件改写 (reviewer P1-3)", () => {
  it("消息含 PUA U+E000 且无 \\$ 时，U+E000 原样保留（不变成 $）", () => {
    const root = renderContent(<MarkdownContent content={"hello  world"} />);
    const vt = visibleText(root);
    expect(vt).toContain("");
    expect(vt).toBe("hello  world");
  });

  it("含 U+E000 又含 \\$x^2\\$ 时：转义公式仍按字面、U+E000 保留", () => {
    // reviewer 复现：icon U+E000 tail \\$x^2\\$ done —— 动态哨兵避开 U+E000，
    // 转义的 \\$x^2\\$ 不被重新激活成公式，且 U+E000 原样保留。
    const root = renderContent(
      <MarkdownContent content={"icon  tail \\$x^2\\$ done"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("$x^2$");
    expect(vt).toContain("");
  });

  it("字符引用解码后的 PUA 也参与哨兵碰撞检查", () => {
    const root = renderContent(
      <MarkdownContent content={"&#xE000; \\$x^2\\$ done"} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    const vt = visibleText(root);
    expect(vt).toContain("");
    expect(vt).toContain("$x^2$");
  });

  it("完整 PUA 区段不影响动态 Unicode 标点哨兵，也不重新激活转义公式", () => {
    const allPua = Array.from({ length: 0xf8ff - 0xe000 + 1 }, (_, i) =>
      String.fromCharCode(0xe000 + i)
    ).join("");
    const root = renderContent(
      <MarkdownContent content={`${allPua} \\$x^2\\$ done`} />
    );
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("$x^2$");
  });
});

describe("MarkdownContent — allowSingleDollarMath 放宽启发式但保留资源上限", () => {
  const losslessFallbackCases: string[] = [
    "$$100 too expensive",
    "$$ TODO: discuss tomorrow",
    "$$meta words\n\\frac{a}\n$$",
    "$$\\bad$$",
    "a $$\\bad$$ b",
  ];

  for (const input of losslessFallbackCases) {
    it(`拒绝后保留 meta、正文与原始定界符：${JSON.stringify(input)}`, () => {
      const root = renderContent(
        <MarkdownContent content={input} allowSingleDollarMath />
      );
      expect(root.querySelector(".katex")).toBeNull();
      expect(visibleText(root)).toContain(input.replace(/\n/g, ""));
    });
  }

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

  it("仍限制每条消息最多尝试 32 个公式", () => {
    const input = Array.from({ length: 40 }, () => "$x^2$").join(" ");
    const root = renderContent(
      <MarkdownContent content={input} allowSingleDollarMath />
    );
    expect(root.querySelectorAll(".katex")).toHaveLength(32);
    expect(visibleText(root)).toContain("$x^2$");
  });

  it("仍拒绝超过块长度上限的 display 公式", () => {
    const input = `$$\n${"x^2+".repeat(1100)}\n$$`;
    const root = renderContent(
      <MarkdownContent content={input} allowSingleDollarMath />
    );
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("$$");
  });

  it("仍拒绝输入未超长但渲染产物超过上限的公式", () => {
    const body = "\\begin{matrix}" + "1 & ".repeat(900) + "1\\end{matrix}";
    const root = renderContent(
      <MarkdownContent content={`$$\n${body}\n$$`} allowSingleDollarMath />
    );
    expect(root.querySelector(".katex")).toBeNull();
    expect(visibleText(root)).toContain("$$");
  });

  const rejectedContainerCases: Array<[string, string]> = [
    ["blockquote", "> $$\n> \\frac{a}\n> $$"],
    ["nested blockquote", "> > $$\n> > \\frac{a}\n> > $$"],
    ["list item", "- $$\n  \\frac{a}\n  $$"],
  ];

  for (const [name, input] of rejectedContainerCases) {
    it(`被拒绝的 display 在 ${name} 中不泄漏容器源码`, () => {
      const root = renderContent(
        <MarkdownContent content={input} allowSingleDollarMath />
      );
      const text = visibleText(root);
      expect(root.querySelector(".katex")).toBeNull();
      expect(text).toContain("$$\\frac{a}$$");
      expect(text).not.toContain(">");
      expect(text).not.toContain("\n\n\n");
    });
  }

  it("enableMath={false} 时即便有 $$ 也不渲染公式", () => {
    const root = renderContent(
      <MarkdownContent content={"$$E=mc^2$$"} enableMath={false} />
    );
    expect(root.querySelector(".katex")).toBeNull();
  });
});
