import React, { useCallback, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import katex from "katex";
import Toast from "@douyinfe/semi-ui/lib/es/toast";
import { Copy } from "lucide-react";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";
import "./markdown.css";
import WKApp from "../../App";
import { isSafeUrl } from "../../Utils/security";
import { linkifySafeUrls } from "../../Utils/linkify";
import { copyToClipboard } from "../../Utils/clipboard";
import { t } from "../../i18n";
import { ImagePreviewLightbox } from "../Image/ImagePreview";
import { getMentionRenderState } from "./mentionRenderState";
import { isForwardDocCard, type ParagraphChildKind } from "./forwardClamp";

export interface MentionInfo {
  name: string; // "@张三"（含@符号）
  uid: string;
}

export interface EmojiInfo {
  key: string; // emoji 文本 key，如 "[有品位]" 或 Unicode "😀"
  url: string; // 图片 URL
}

interface MarkdownContentProps {
  content: string;
  isSend?: boolean;
  isStreaming?: boolean;
  mentions?: MentionInfo[];
  onMentionClick?: (uid: string) => void;
  emojis?: EmojiInfo[];
  /**
   * 是否启用数学公式渲染（KaTeX），默认 true。
   *
   * 聊天消息默认识别 `$...$` 行内与 `$$...$$` 块级公式，并用候选守卫（{@link isAcceptableInlineMath}）
   * 过滤 IM 正文误匹配（金额/变量/JSON/路径）。为保证正文零腐蚀，行内候选比 iOS 更严：
   * 含 `/`、`:`、单字母反斜杠、或多个词形 token 的片段按正文处理；纯 CJK 且不含真正 TeX 命令
   * 的 `$金额_x$` 不渲染，但含命令的 `$v_{\text{平均}}$` 照常渲染。需要放宽（如无特殊字符的
   * 简单 `$a+b$`）见 {@link allowSingleDollarMath}。明确不需要公式时可传 false。
   */
  enableMath?: boolean;
  /**
   * 是否跳过 math-ish 守卫、无条件识别所有 `$...$` / `$$...$$` 为公式，默认 false。
   *
   * 聊天默认路径（false）识别 `$...$` / `$$...$$`，但对齐 iOS 用 math-ish 守卫过滤：
   * 只有内部含 `\ ^ _ { }` 之一的片段才当公式渲染，`$100`、`$5-$10`、`$HOME` 等
   * 金额/shell 场景保持原文。文档/编辑器等作者显式书写公式的场景可传 true 关掉守卫，
   * 让 `$a+b$` 这类无特殊字符的简单公式也渲染。
   */
  allowSingleDollarMath?: boolean;
  /**
   * 是否启用 Markdown 语法渲染，默认 true。
   * RichText(=14) MVP 锁纯文本：传 false 时按纯文本渲染（保留换行/链接/emoji/mention），
   * 不解析标题/列表/表格/代码块等 markdown 语法，避免 web 渲 markdown 而移动端不渲的跨端不一致。
   */
  enableMarkdown?: boolean;
}

/**
 * 在 GitHub 默认白名单基础上，追加 highlight.js 需要的 class 属性。
 * 执行顺序：rehypeHighlight 先着色（加 hljs-* className），
 * rehypeSanitize 最后兜底清洗——白名单里的 hljs-* / language-* 才真正生效。
 * 注意：react-markdown 的输入是 Markdown 字符串，remark 直接解析成安全 AST，
 * 不存在注入 HTML 的机会（未开启 allowDangerousHtml），所以 highlight 先跑不会引入风险。
 */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // 放行代码块的 language-* class（highlight.js 加的）
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-/, /^hljs/],
    ],
    // highlight.js token + remark-math handoff classes. KaTeX runs after sanitize.
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      ["className", /^hljs/, "math", "math-inline"],
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ["className", "math", "math-display"],
    ],
  },
};

/** 基础 rehype 插件（不含 KaTeX） */
const baseRehypePlugins: any[] = [
  [rehypeHighlight, { aliases: { json5: "json" }, ignoreMissing: true }],
  [rehypeSanitize, sanitizeSchema],
];

const remarkGfmOptions = { singleTilde: false };

/**
 * KaTeX runs after sanitize: user-derived AST is cleaned first, then trusted KaTeX output keeps
 * its required inline styles and MathML structure. Resource limits prevent pathological formulas.
 *
 * ⚠️ Security invariant: because sanitize no longer runs *after* KaTeX, `trust: false` is the only
 * thing keeping a formula from emitting raw HTML (e.g. `\href`, `\htmlClass`). Do NOT flip it to
 * true on this shared message path — that would turn arbitrary chat text into an HTML-injection sink.
 *
 * Resource bounds (both below KaTeX defaults on purpose, since this renders untrusted chat text):
 *  - `maxSize: 10`  — clamps `\rule` / strut width+height so a single formula can't blow up layout.
 *  - `maxExpand: 100` — caps macro expansion against `\newcommand` bombs. Real formulas
 *    (`aligned`, `pmatrix`, chained arrows, ~40-term user-macro expansions) stay well under 100;
 *    raise it only if a legitimate formula is observed hitting the cap.
 */
const mathRehypePlugins: any[] = [
  [rehypeHighlight, { aliases: { json5: "json" }, ignoreMissing: true }],
  [rehypeSanitize, sanitizeSchema],
  guardMathFencePlugin,
  [
    rehypeKatex,
    { strict: false, throwOnError: false, trust: false, maxSize: 10, maxExpand: 100 },
  ],
  katexErrorToTextPlugin,
];

/**
 * ```` ```math ```` 围栏代码块会经 remark-rehype 变成 `<code class="language-math">`，rehype-katex
 * 会把它当 display 公式直接渲染——绕过 scanner 的长度 / 数量 / 渲染产物上限。这里在 rehype-katex
 * 之前用同一套 chokepoint 把关：内容需非空 + 含 math-ish + 不超块长上限 + KaTeX 可解析且渲染产物
 * 不超上限；不满足就摘掉 `language-math` class，退回普通代码块（不进 KaTeX）。
 */
function guardMathFencePlugin() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (!node || !Array.isArray(node.children)) return;
      for (const child of node.children) {
        if (child?.type === "element" && child.tagName === "code") {
          const cls = child.properties?.className;
          const classes = Array.isArray(cls)
            ? cls
            : typeof cls === "string"
            ? cls.split(/\s+/)
            : [];
          if (classes.includes("language-math")) {
            const tex = hastNodeText(child).replace(/\n+$/, "");
            const ok =
              tex.trim().length > 0 &&
              MATH_ISH_CHAR.test(tex) &&
              tex.length <= MAX_BLOCK_MATH_LEN &&
              katexAccepts(tex, true);
            if (!ok) {
              child.properties = child.properties || {};
              child.properties.className = classes.filter(
                (c: string) => c !== "language-math"
              );
            }
            continue;
          }
        }
        visit(child);
      }
    };
    visit(tree);
  };
}

/** 提取 hast 节点的纯文本内容。 */
function hastNodeText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.value || "";
  if (Array.isArray(node.children)) return node.children.map(hastNodeText).join("");
  return "";
}

/**
 * KaTeX 解析失败时（`throwOnError:false` 会渲染 `.katex-error` 红字）把该节点降级成纯文本，
 * 避免普通聊天里冒出红色报错。展示公式源码原文（去掉红色样式），与「误匹配一律回落到正文」
 * 的整体策略一致。守卫已挡掉绝大多数正文，此处只兜住真被判定为公式却 KaTeX 解析失败的少数情况。
 */
function katexErrorToTextPlugin() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (!node || !Array.isArray(node.children)) return;
      node.children = node.children.map((child: any) => {
        const cls = child?.properties?.className;
        const classes = Array.isArray(cls)
          ? cls
          : typeof cls === "string"
          ? cls.split(/\s+/)
          : [];
        if (child?.type === "element" && classes.includes("katex-error")) {
          return { type: "text", value: hastNodeText(child) };
        }
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
}

/** 基础 remark 插件（不含 math） */
const baseRemarkPlugins: any[] = [
  rawHtmlAsTextPlugin,
  [remarkGfm, remarkGfmOptions],
  remarkBreaks,
];

/**
 * 聊天默认路径：自研单次左到右扫描器 {@link mathScanPlugin} 直接在 mdast 文本节点上识别公式。
 * 顺序要点：
 *  - {@link escapeMaskPlugin} 必须排最前：它在 markdown 解析前把「源码里被反斜杠转义的 `$`」换成
 *    哨兵字符（代码区不动），从根上稳定保存转义信息，避免解析后再从 source slice 反推（会在实体 /
 *    软换行 / blockquote 续行处 fail-open，把 `\$` 重新激活成定界符）；
 *  - mathScanPlugin 在 remarkBreaks 之前：否则 breaks 会把块级 `$$\n…\n$$` 的软换行拆散；
 *  - {@link restoreSentinelPlugin} 最后把哨兵还原成字面 `$`。
 * 行内代码 / 代码块是独立节点，天然不被 scanner 触碰。所有进入 KaTeX 的 route（行内 `$`、块级 `$$`、
 * ```math 围栏）都过同一套长度 / 数量 / 渲染产物上限。
 */
const mathRemarkPlugins: any[] = [
  escapeMaskPlugin,
  rawHtmlAsTextPlugin,
  [remarkGfm, remarkGfmOptions],
  mathScanPlugin,
  remarkBreaks,
  restoreSentinelPlugin,
];

/** 文档 / 编辑器场景：无条件识别所有 `$...$` / `$$...$$`，不加守卫（作者显式书写公式）。 */
const mathRemarkPluginsSingleDollar: any[] = [
  rawHtmlAsTextPlugin,
  [remarkGfm, remarkGfmOptions],
  remarkBreaks,
  remarkMath,
];

/** math-ish 内部字符：与 iOS WKLaTeXPreprocessor.hasMathChar 完全一致。 */
const MATH_ISH_CHAR = /[\\^_{}]/;

/** CJK / 假名 / 谚文 / 全角标点（含 BMP 外汉字）：无命令的行内候选视为正文。 */
const CJK_CHAR =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}＀-￯]/u;

/** 行内公式候选长度上限，对齐 iOS 的 blast-radius 控制。 */
const MAX_INLINE_MATH_LEN = 200;

/** 多字母 TeX 命令，如 \frac \eta \text \sum —— 出现即视为明确的公式意图。 */
const MULTI_LETTER_TEX_CMD = /\\[A-Za-z]{2,}/;
/** 单字母反斜杠（\a \b \t…）：更像 Windows 路径 / 转义，而非行内 TeX 命令。 */
const SINGLE_LETTER_BACKSLASH = /\\[A-Za-z](?![A-Za-z])/;

/** 上标：`^` 后接 group / 字母数字 / 命令。 */
const TEX_SUPERSCRIPT = /\^(\{|[A-Za-z0-9]|\\)/;
/** 单字符底的下标：底字符前是非字母数字（排除 snake_case 的多字母段），`_` 后接 group / 字母数字 / 命令。 */
const TEX_SINGLE_CHAR_SUBSCRIPT = /(^|[^A-Za-z0-9])[A-Za-z0-9]_(\{|[A-Za-z0-9]|\\)/;
/** 块级 display 公式长度上限：过长（如 4.8KB）KaTeX 渲染耗时明显，超限按文本处理。 */
const MAX_BLOCK_MATH_LEN = 4096;
/** KaTeX 预校验 / 渲染选项（与 rehype-katex 一致，仅 throwOnError 打开用于判定）。 */
const KATEX_VALIDATE_OPTS = {
  strict: false,
  throwOnError: true,
  trust: false,
  maxSize: 10,
  maxExpand: 100,
};

/** 候选内部是否含真正的 TeX 构造（多字母命令 / 上标 / 单字符底下标）。 */
function isTeXish(inner: string): boolean {
  return (
    MULTI_LETTER_TEX_CMD.test(inner) ||
    TEX_SUPERSCRIPT.test(inner) ||
    TEX_SINGLE_CHAR_SUBSCRIPT.test(inner)
  );
}

/**
 * 行内 `$…$` / `$$…$$` 候选是否按公式接受。仅含某个 math-ish 字符远远不够——IM 正文里
 * `_`（snake_case）、`\`（路径）、`{}`（`${VAR}` / JSON）、`^`、`:`、`/` 都很常见。这里用
 * 正向 TeX 白名单 + shell/path/prose 负向信号双重把关（比 iOS 的 hasMathChar 更严）：
 *  - 不跨行、长度 ≤ 200、非空、含 math-ish；
 *  - 拒绝以 `{` 开头（`${VAR}` / `${A}+${B}` 这类 shell/CI/模板插值）；
 *  - 拒绝含 `/` `:`（路径 / URL / env / 比值）、单字母反斜杠 `\a`/`\b`（路径 / 转义）；
 *  - 单 `$…$` 要求定界符两侧紧贴非空白（Pandoc）；`$$…$$` 允许 padding；
 *  - 必须含真正 TeX 构造；无多字母命令时再拒绝 CJK / ≥2 个词形 token（`for my var`、`HOME DIR`）。
 * 取舍：无命令的纯 CJK 行内公式（`$金额_x$`）不渲染；含命令的 `$v_{\text{平均}}$` 正常渲染。
 */
function isAcceptableInlineMath(inner: string, isDouble: boolean): boolean {
  if (/[\r\n]/.test(inner)) return false;
  if (inner.length > MAX_INLINE_MATH_LEN) return false;
  const core = inner.trim();
  if (core.length === 0) return false;
  if (core.startsWith("{")) return false; // ${VAR} / ${A}+${B} shell/模板插值
  if (!MATH_ISH_CHAR.test(core)) return false;
  if (/[/:]/.test(core)) return false; // 路径 / URL / env / 比值
  if (SINGLE_LETTER_BACKSLASH.test(core)) return false; // \a \b → 路径 / 转义
  if (!isDouble && (/^\s/.test(inner) || /\s$/.test(inner))) return false; // Pandoc 邻接
  if (!isTeXish(core)) return false;
  if (!MULTI_LETTER_TEX_CMD.test(core)) {
    if (CJK_CHAR.test(core)) return false;
    const proseWords = core.replace(/\\[A-Za-z]+/g, " ").match(/[A-Za-z]{2,}/g);
    if (proseWords && proseWords.length >= 2) return false;
  }
  return true;
}

/** KaTeX 能否解析该公式（预校验：失败则整体按字面文本保留，不产生红字、不丢定界符）。 */
function katexAccepts(inner: string, displayMode: boolean): boolean {
  try {
    const html = katex.renderToString(inner, {
      ...KATEX_VALIDATE_OPTS,
      displayMode,
    });
    // 渲染后 HTML 长度上限：接收端保护，挡住病态公式放大成 MB 级 HTML / 数万 DOM 节点。
    if (html.length > MAX_RENDERED_MATH_LEN) return false;
    return true;
  } catch {
    return false;
  }
}

/** 单条公式渲染后 HTML 长度上限（约 3.8KB 输入可膨胀到 >1MB / 3 万 DOM 节点）。 */
const MAX_RENDERED_MATH_LEN = 60000;
/** 单条消息公式数量上限：超出后其余候选按文本处理。 */
const MAX_FORMULAS_PER_MESSAGE = 32;

/**
 * display `$$…$$` 是否为「行锚定块」：opener 所在行 `$$` 前只有空白（行首），closer 所在行 `$$`
 * 后只有空白（行尾）。只有锚定块才当 display 公式；否则是跨软换行的普通 prose（`cost $$5 for\n…$$`），
 * 交回行内路径由 isAcceptableInlineMath 拦截，避免把 shell/prose 吞成 display math。
 */
function isAnchoredDisplay(text: string, openIdx: number, closeIdx: number): boolean {
  let a = openIdx - 1;
  while (a >= 0 && (text[a] === " " || text[a] === "\t")) a -= 1;
  const openerAtLineStart = a < 0 || text[a] === "\n";
  let b = closeIdx + 2;
  while (b < text.length && (text[b] === " " || text[b] === "\t")) b += 1;
  const closerAtLineEnd = b >= text.length || text[b] === "\n";
  return openerAtLineStart && closerAtLineEnd;
}

/** 私用区哨兵：代表「源码里被转义的 `$`」，扫描器视其为普通字符，最后再还原成字面 `$`。 */
const MATH_ESCAPE_SENTINEL = "\uE000";

/** 收集 code / inlineCode 节点的源码区间（转义遮罩时跳过，代码里的 `\$` 原样保留）。 */
function collectCodeRanges(node: any, ranges: Array<[number, number]>): void {
  if (!node) return;
  if (node.type === "code" || node.type === "inlineCode") {
    const s = node.position?.start?.offset;
    const e = node.position?.end?.offset;
    if (typeof s === "number" && typeof e === "number") ranges.push([s, e]);
    return;
  }
  if (Array.isArray(node.children)) {
    for (const c of node.children) collectCodeRanges(c, ranges);
  }
}

/** 把源码里（代码区外）被反斜杠转义的 `$` 换成哨兵；奇偶反斜杠计数区分 `\$`（转义）与 `\\$`（字面反斜杠+活 `$`）。 */
function maskEscapedDollars(
  source: string,
  ranges: Array<[number, number]>
): string {
  const inCode = (off: number) =>
    ranges.some(([s, e]) => off >= s && off < e);
  const n = source.length;
  let out = "";
  let i = 0;
  while (i < n) {
    if (source[i] === "\\") {
      let k = i;
      while (k < n && source[k] === "\\") k += 1;
      const runLen = k - i;
      if (source[k] === "$" && runLen % 2 === 1 && !inCode(k)) {
        out += "\\".repeat(runLen - 1) + MATH_ESCAPE_SENTINEL;
        i = k + 1;
        continue;
      }
      out += source.slice(i, k);
      i = k;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/**
 * 在 markdown 解析前稳定保存转义信息：把源码里（代码区外）被反斜杠转义的 `$` 换成哨兵，再用同一
 * processor 重新解析整篇。转义信息直接来自原始源码（看得到反斜杠），代码区间来自首次解析的 code
 * 节点——不依赖解析后从 source slice 反推（那在实体 / 软换行 / blockquote 续行处会 fail-open）。
 */
function escapeMaskPlugin(this: any) {
  const processor = this;
  return (tree: any, file: any) => {
    const source: string =
      typeof file?.value === "string" ? file.value : String(file ?? "");
    if (source.indexOf("\\$") === -1 || typeof processor?.parse !== "function") {
      return;
    }
    const ranges: Array<[number, number]> = [];
    collectCodeRanges(tree, ranges);
    const masked = maskEscapedDollars(source, ranges);
    if (masked === source) return;
    const reparsed = processor.parse(masked);
    tree.children = reparsed.children;
  };
}

/** 把哨兵还原成字面 `$`（在 scanner 之后运行，确保被转义的 `$` 只作字面文本）。 */
function restoreSentinelPlugin() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (!node || !Array.isArray(node.children)) return;
      for (const child of node.children) {
        if (
          child?.type === "text" &&
          typeof child.value === "string" &&
          child.value.indexOf(MATH_ESCAPE_SENTINEL) !== -1
        ) {
          child.value = child.value.split(MATH_ESCAPE_SENTINEL).join("$");
        } else {
          visit(child);
        }
      }
    };
    visit(tree);
  };
}

/** 构造 mdast 公式节点，带 remark-rehype 交接所需的 hName/hProperties/hChildren，供 rehype-katex 渲染。 */
function makeMathNode(inner: string, display: boolean): any {
  return {
    type: display ? "math" : "inlineMath",
    value: inner,
    data: {
      hName: display ? "div" : "span",
      hProperties: {
        className: display ? ["math", "math-display"] : ["math", "math-inline"],
      },
      hChildren: [{ type: "text", value: inner }],
    },
  };
}

/**
 * 单次左到右扫描一段文本，识别 `$…$` / `$$…$$` 公式，返回 mdast 节点序列（text / inlineMath / math）。
 * 关键：候选被拒绝时只跳过本 opener（前移 openLen），后续 `$` 仍可开新候选——因此货币 `$100`
 * 不会吃掉后面 `$E=mc^2$` 的定界符；被拒绝的定界符与文本 100% 原样保留。
 */
function scanTextForMath(text: string, ctx: { count: number }): any[] {
  const out: any[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ type: "text", value: buf });
      buf = "";
    }
  };
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text[i] !== "$") {
      buf += text[i];
      i += 1;
      continue;
    }
    const isDouble = text[i + 1] === "$";
    const openLen = isDouble ? 2 : 1;
    let close = -1;
    let j = i + openLen;
    while (j < n) {
      if (isDouble) {
        if (text[j] === "$" && text[j + 1] === "$") {
          close = j;
          break;
        }
        if (text[j] === "\n" && text[j + 1] === "\n") break; // 不跨空行
      } else {
        if (text[j] === "\n") break; // 单 $ 不跨行
        if (text[j] === "$") {
          close = j;
          break;
        }
      }
      j += 1;
    }
    if (close >= i + openLen) {
      const inner = text.slice(i + openLen, close);
      const hasNewline = inner.indexOf("\n") !== -1;
      const display =
        isDouble && hasNewline && isAnchoredDisplay(text, i, close); // $$ 跨行 → display block；否则行内
      let accept: boolean;
      if (display) {
        accept =
          inner.trim().length > 0 &&
          MATH_ISH_CHAR.test(inner) &&
          inner.length <= MAX_BLOCK_MATH_LEN;
      } else {
        // 行内：定界符不能紧贴单词字符（挡 shell 多变量 `echo $X_1,$Y_2`——闭定界符后紧跟
        // 标识符，说明它其实是下一个 $var 的开定界符，而非公式收尾）。
        const before = i > 0 ? text[i - 1] : "";
        const after = close + openLen < n ? text[close + openLen] : "";
        const wordAdjacent =
          /[A-Za-z0-9]/.test(before) || /[A-Za-z0-9_]/.test(after);
        accept = !wordAdjacent && isAcceptableInlineMath(inner, isDouble);
      }
      if (
        accept &&
        ctx.count < MAX_FORMULAS_PER_MESSAGE &&
        katexAccepts(inner, display)
      ) {
        flush();
        out.push(makeMathNode(inner, display));
        ctx.count += 1;
        i = close + openLen;
        continue;
      }
    }
    // 拒绝：定界符按字面文本，只前移 openLen，后面的 `$` 仍能开新候选
    buf += text.slice(i, i + openLen);
    i += openLen;
  }
  flush();
  return out;
}

/**
 * 自研公式扫描插件（替代聊天路径的 remark-math）。遍历 mdast，对每个含 `$` 的 `text` 节点跑
 * {@link scanTextForMath}，把识别出的公式拆成 inlineMath/math 节点。必须在 remarkBreaks 之前运行。
 */
function mathScanPlugin() {
  return (tree: any) => {
    const ctx = { count: 0 };
    const visit = (node: any) => {
      if (!node || !Array.isArray(node.children)) return;
      const next: any[] = [];
      for (const child of node.children) {
        if (
          child?.type === "text" &&
          typeof child.value === "string" &&
          child.value.indexOf("$") !== -1
        ) {
          const parts = scanTextForMath(child.value, ctx);
          if (parts.some((p) => p.type === "inlineMath" || p.type === "math")) {
            next.push(...parts);
          } else {
            next.push(child);
          }
        } else {
          visit(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    visit(tree);
  };
}

function rawHtmlAsTextPlugin() {
  return (tree: any) => {
    const visit = (node: any) => {
      if (!node || !Array.isArray(node.children)) return;
      node.children = node.children.map((child: any) => {
        if (child?.type === "html") {
          return { type: "text", value: child.value || "" };
        }
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
}

/**
 * 纯文本模式（enableMarkdown=false）插件：
 *   - remark 只保留 remarkBreaks（换行转 <br>），不启用 gfm，避免 markdown 语法解析；
 *   - rehype 只保留 sanitize 兜底清洗。
 * 配合 escapeMarkdown 转义，最终按纯文本渲染（与移动端「不渲 markdown」对齐）。
 */
const plainRemarkPlugins: any[] = [remarkBreaks];
const plainRehypePlugins: any[] = [[rehypeSanitize, sanitizeSchema]];

/**
 * 转义 markdown 语法字符，使内容按纯文本渲染：
 * 反斜杠转义后 react-markdown 渲染时会还原为原字符（不显示反斜杠），
 * 从而禁用标题/加粗/列表/代码块/表格/链接等一切 markdown 语法。
 */
function escapeMarkdown(raw: string): string {
  return raw.replace(/[\\`*_{}[\]()#+\-.!>|~]/g, "\\$&");
}

function escapeMarkdownLinkDestination(href: string): string {
  return href.replace(/\\/g, "%5C").replace(/>/g, "%3E");
}

function escapeMarkdownPreservingSafeLinks(raw: string): string {
  return linkifySafeUrls(raw)
    .map((segment) => {
      if (segment.type === "text") return escapeMarkdown(segment.content);
      return `[${escapeMarkdown(
        segment.text
      )}](<${escapeMarkdownLinkDestination(segment.href)}>)`;
    })
    .join("");
}

/**
 * 预处理 Markdown 内容：
 * 把独占一行的 --- / === 补充前后空行，避免被解析成 setext 标题（h2/h1）。
 * 跳过 fenced code block（```...```）内的内容，避免误处理 YAML 等代码中的分隔线。
 */
function normalizeContent(raw: string): string {
  // 把字符串按 fenced code block 切分：
  // 奇数索引 = 代码块内容（保持原样），偶数索引 = 普通文本（需要处理）
  const parts = raw.split(/(```[\s\S]*?```)/g);
  const processed = parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part
      .replace(/([^\n])\n([-*_]{3,})\n/g, "$1\n\n$2\n\n")
      .replace(/(^|\n)([-*_]{3,})(\n|$)/g, "\n\n$2\n\n")
      .replace(/\n{3,}/g, "\n\n");
  });
  return processed.join("").trim();
}

type Segment =
  | { type: "text"; content: string }
  | { type: "mention"; name: string; uid: string }
  | { type: "emoji"; key: string; url: string };

function segmentText(
  text: string,
  mentions: MentionInfo[],
  emojis: EmojiInfo[]
): Segment[] {
  if (!mentions.length && !emojis.length) {
    return [{ type: "text", content: text }];
  }

  // 合并 mention 和 emoji，按 key/name 长度降序排列（防止短 key 提前匹配）
  type Token =
    | { kind: "mention"; name: string; uid: string }
    | { kind: "emoji"; key: string; url: string };

  const tokens: Token[] = [
    ...mentions.map((m) => ({
      kind: "mention" as const,
      name: m.name,
      uid: m.uid,
    })),
    ...emojis.map((e) => ({ kind: "emoji" as const, key: e.key, url: e.url })),
  ].sort((a, b) => {
    const aLen = a.kind === "mention" ? a.name.length : a.key.length;
    const bLen = b.kind === "mention" ? b.name.length : b.key.length;
    return bLen - aLen;
  });

  const escaped = tokens.map((t) => {
    const raw = t.kind === "mention" ? t.name : t.key;
    return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });

  const regex = new RegExp(`(${escaped.join("|")})`, "g");

  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }
    const matched = match[0];
    const token = tokens.find((t) =>
      t.kind === "mention" ? t.name === matched : t.key === matched
    )!;
    if (token.kind === "mention") {
      segments.push({ type: "mention", name: token.name, uid: token.uid });
    } else {
      segments.push({ type: "emoji", key: token.key, url: token.url });
    }
    lastIndex = match.index + matched.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments;
}

function reactNodeText(children: React.ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(reactNodeText).join("");
  if (React.isValidElement(children)) {
    return reactNodeText((children.props as any)?.children);
  }
  return "";
}

const MarkdownCodeBlock: React.FC<{
  children: React.ReactNode;
  preProps: any;
  isStreaming?: boolean;
}> = ({ children, preProps, isStreaming = false }) => {
  const [copying, setCopying] = useState(false);

  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (copying) return;

    setCopying(true);
    try {
      const ok = await copyToClipboard(
        reactNodeText(children).replace(/\n$/, "")
      );
      if (ok) {
        Toast.success(t("base.message.markdown.copyCodeSuccess"));
      } else {
        Toast.warning(t("base.module.contextMenus.copyFailed"));
      }
    } catch {
      Toast.warning(t("base.module.contextMenus.copyFailed"));
    } finally {
      setCopying(false);
    }
  };

  const copyLabel = t("base.message.markdown.copyCode");

  return (
    <div className="wk-markdown-pre-wrapper">
      {!isStreaming && (
        <button
          type="button"
          className="wk-markdown-code-copy"
          aria-label={copyLabel}
          title={copyLabel}
          disabled={copying}
          onClick={handleCopy}
        >
          <Copy size={14} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      <pre {...preProps}>{children}</pre>
    </div>
  );
};

const baseComponents: any = {
  a: ({ href, children, ...props }: any) => {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
  p: ({ node: _node, children, ...props }: any) =>
    renderParagraph(children, props),
  pre: ({ children, ...props }: any) => (
    <MarkdownCodeBlock preProps={props}>{children}</MarkdownCodeBlock>
  ),
  img: ({ src, alt }: any) => <MarkdownImage src={src} alt={alt} />,
};

const streamingBaseComponents: any = {
  ...baseComponents,
  pre: ({ children, ...props }: any) => (
    <MarkdownCodeBlock preProps={props} isStreaming>
      {children}
    </MarkdownCodeBlock>
  ),
};

/**
 * Flatten a React child into its plain text (strings + nested string arrays only). Used to read the
 * visible label of a bold/link run for the forward-card structure check; non-string nodes (nested
 * elements) contribute nothing, which is fine — a real forward title/anchor is a plain string.
 */
function plainText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(plainText).join("");
  return "";
}

/**
 * Paragraph renderer with the AC-13b forward-card title clamp (contract 5 structure heuristic).
 *
 * Safe passthrough for EVERY other message: it only adds the 2-line-clamp class + `title` tooltip
 * when the paragraph is exactly the forwarded-doc shape (leading bold title + a link — detected via
 * {@link isForwardDocCard}). Anything else renders as a plain `<p>` unchanged, so no existing
 * message's bold text is affected. The full title lives in the `title` attribute so PC hover /
 * mobile tap still reveals it in full while the visible text is clamped to 2 lines.
 */
function renderParagraph(
  children: React.ReactNode,
  props: any
): React.ReactElement {
  const arr = React.Children.toArray(children);
  const kinds: ParagraphChildKind[] = arr.map((c) => {
    if (typeof c === "string") return { text: c };
    if (React.isValidElement(c)) {
      const type = (c as React.ReactElement).type as any;
      const cprops = (c.props ?? {}) as any;
      // Carry the visible text of bold/link runs so the detector can require the link label to
      // equal the bold title (the forward card duplicates the title as its anchor text).
      if (type === "strong" || type === "b")
        return { isStrong: true, content: plainText(cprops.children) };
      if (type === "br") return { isBreak: true };
      if (cprops.href != null || type === baseComponents.a)
        return { isLink: true, content: plainText(cprops.children) };
    }
    return {};
  });
  if (!isForwardDocCard(kinds)) {
    return <p {...props}>{children}</p>;
  }
  // Clone the leading <strong> to carry the full-title tooltip + clamp class.
  const clamped = arr.map((c, i) => {
    if (
      React.isValidElement(c) &&
      ((c.type as any) === "strong" || (c.type as any) === "b")
    ) {
      const cprops = c.props as any;
      // Read the title text array-safely: react-markdown 8.x always hands `strong` an ARRAY of
      // children (e.g. ["Quarterly plan"]), never a bare string, so the old
      // `typeof children === "string"` guard left `full` undefined → no `title` attribute → the
      // hover tooltip silently vanished (XIN-450 P1). plainText() flattens the string/array/nested
      // shapes the same way the forward-card detector above does; `|| undefined` keeps the attribute
      // absent (rather than an empty `title=""`) when there is no text.
      const full = plainText(cprops?.children) || undefined;
      return React.cloneElement(c as React.ReactElement<any>, {
        key: i,
        className: `${
          cprops?.className ?? ""
        } wk-markdown-forward-title`.trim(),
        title: full,
      });
    }
    return c;
  });
  return (
    <p
      {...props}
      className={`${props?.className ?? ""} wk-markdown-forward-card`.trim()}
    >
      {clamped}
    </p>
  );
}

/**
 * Markdown / RichText 正文内联图片：
 *  - url 安全校验（仅 http/https，挡 data:/javascript:/file: 等），不安全则降级为文本占位；
 *  - 点击复用 ImageCell 的大图预览与底部工具栏；
 *  - src 经 datasource 处理，与其它图片渲染路径补全 base URL 保持一致。
 */
const MarkdownImage: React.FC<{ src?: string; alt?: string }> = ({
  src,
  alt,
}) => {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  // 经 datasource 解析（补全 base URL / 相对路径改写），与 ImageCell 一致。
  const resolved =
    WKApp.dataSource?.commonDataSource?.getImageURL?.(src) || src;
  // 安全校验：解析后必须是 http/https 绝对地址，否则降级为纯文本占位，绝不渲染。
  if (!isSafeUrl(resolved)) {
    return (
      <span className="wk-markdown-img-unsafe">
        {alt || t("base.message.digest.image")}
      </span>
    );
  }
  return (
    <>
      <img
        className="wk-markdown-img"
        src={resolved}
        alt={alt || ""}
        loading="lazy"
        onClick={() => setOpen(true)}
      />
      <ImagePreviewLightbox
        open={open}
        close={() => setOpen(false)}
        slides={[{ src: resolved, alt: alt || "" }]}
        filename={alt || "image.png"}
      />
    </>
  );
};

/**
 * 递归处理 React children，将匹配 emoji/mention 的文本节点替换为对应的 React 元素。
 * 在 ReactMarkdown 渲染后的组件树上工作，不会破坏表格等块级 markdown 结构。
 */
function processTextChildren(
  children: React.ReactNode,
  mentions: MentionInfo[],
  emojis: EmojiInfo[],
  onMentionClick?: (uid: string) => void,
  isSend?: boolean
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      const segments = segmentText(child, mentions, emojis);
      if (segments.length === 1 && segments[0].type === "text") return child;
      return segments.map((seg, i) => {
        if (seg.type === "mention") {
          const mentionState = getMentionRenderState(seg.uid);
          return (
            <span
              key={i}
              className={mentionState.className}
              onClick={
                mentionState.interactive
                  ? () => seg.uid && onMentionClick?.(seg.uid)
                  : undefined
              }
            >
              {seg.name}
            </span>
          );
        }
        if (seg.type === "emoji") {
          return (
            <span key={i} className="wk-message-text-richemoji">
              <img alt={seg.key} src={seg.url} width={22} height={22} />
            </span>
          );
        }
        return seg.content;
      });
    }
    if (React.isValidElement(child)) {
      const childProps = child.props as any;
      // KaTeX 渲染输出（.katex / .katex-display 及其内部 MathML、application/x-tex
      // annotation）不再向下做 mention/emoji 分段：否则会把 mention <span>（含 onClick）
      // 或 emoji <img> 插进 MathML 的 <mtext> 与 TeX annotation，产生无效 MathML、
      // 污染 copy-as-LaTeX 与无障碍读屏。公式内部的 `@名字` / `[emoji]` 应保持公式原文。
      const className =
        typeof childProps.className === "string" ? childProps.className : "";
      if (className.split(/\s+/).some((c) => c.startsWith("katex"))) {
        return child;
      }
      if (childProps.children != null) {
        return React.cloneElement(
          child as React.ReactElement<any>,
          {},
          processTextChildren(
            childProps.children,
            mentions,
            emojis,
            onMentionClick,
            isSend
          )
        );
      }
    }
    return child;
  });
}

const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  isSend = false,
  isStreaming,
  mentions = [],
  onMentionClick,
  emojis = [],
  enableMath = true,
  allowSingleDollarMath = false,
  enableMarkdown = true,
}) => {
  const normalized = useMemo(
    () =>
      enableMarkdown
        ? normalizeContent(content)
        : escapeMarkdownPreservingSafeLinks(content),
    [content, enableMarkdown]
  );

  // Stabilize mentions/emojis references: only swap when actual content changes.
  // Parent re-renders triggered by scroll events create new array instances with
  // the same content; without this the components useMemo below would invalidate
  // every scroll, causing ReactMarkdown to unmount/remount emoji <img> elements
  // and produce a visible flicker (especially noticeable with DevTools open).
  const mentionsJson = JSON.stringify(mentions);
  const stableMentions = useRef(mentions);
  const prevMentionsJson = useRef(mentionsJson);
  if (mentionsJson !== prevMentionsJson.current) {
    prevMentionsJson.current = mentionsJson;
    stableMentions.current = mentions;
  }

  const emojisJson = JSON.stringify(emojis);
  const stableEmojis = useRef(emojis);
  const prevEmojisJson = useRef(emojisJson);
  if (emojisJson !== prevEmojisJson.current) {
    prevEmojisJson.current = emojisJson;
    stableEmojis.current = emojis;
  }

  // Stable callback: always calls the latest onMentionClick without producing
  // a new function reference on each render.
  const onMentionClickLatest = useRef(onMentionClick);
  onMentionClickLatest.current = onMentionClick;
  const stableOnMentionClick = useCallback((uid: string) => {
    onMentionClickLatest.current?.(uid);
  }, []);

  const hasTokens =
    stableMentions.current.length > 0 || stableEmojis.current.length > 0;

  const components = useMemo(() => {
    const activeBaseComponents = isStreaming
      ? streamingBaseComponents
      : baseComponents;
    if (!hasTokens) return activeBaseComponents;
    const process = (children: React.ReactNode) =>
      processTextChildren(
        children,
        stableMentions.current,
        stableEmojis.current,
        stableOnMentionClick,
        isSend
      );
    const wrap =
      (Tag: string) =>
      ({
        node,
        children,
        ordered,
        checked,
        index,
        siblingCount,
        ...props
      }: any) =>
        React.createElement(Tag, props, process(children));
    return {
      ...activeBaseComponents,
      p: wrap("p"),
      td: wrap("td"),
      th: wrap("th"),
      li: wrap("li"),
      h1: wrap("h1"),
      h2: wrap("h2"),
      h3: wrap("h3"),
      h4: wrap("h4"),
      h5: wrap("h5"),
      h6: wrap("h6"),
    };
  }, [
    hasTokens,
    stableMentions.current,
    stableEmojis.current,
    stableOnMentionClick,
    isSend,
    isStreaming,
  ]);

  // 根据是否启用数学公式 / markdown 选择插件
  const remarkPlugins = !enableMarkdown
    ? plainRemarkPlugins
    : enableMath
    ? allowSingleDollarMath
      ? mathRemarkPluginsSingleDollar
      : mathRemarkPlugins
    : baseRemarkPlugins;
  const rehypePlugins = !enableMarkdown
    ? plainRehypePlugins
    : enableMath
    ? mathRehypePlugins
    : baseRehypePlugins;

  return (
    <div
      className={`wk-markdown ${
        isSend ? "wk-markdown-send" : "wk-markdown-recv"
      }`}
    >
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {normalized}
      </ReactMarkdown>
      {isStreaming && <span className="wk-stream-cursor" />}
    </div>
  );
};

export { MarkdownImage };
export default MarkdownContent;
