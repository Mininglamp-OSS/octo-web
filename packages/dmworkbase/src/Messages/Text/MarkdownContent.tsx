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
   * 简单 `$a+b$`）见 {@link allowSingleDollarMath}。独占的 `$$...$$` 仍需含 TeX 构造或运算符，
   * 避免把纯 prose 静默压成数学文本。明确不需要公式时可传 false。
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
 *  - `maxExpand: 100` — second-line expansion cap; user-defined macros are rejected before KaTeX
 *    because short definitions can otherwise expand into megabytes before this count is reached.
 */
const mathRehypePlugins: any[] = [
  [rehypeHighlight, { aliases: { json5: "json" }, ignoreMissing: true }],
  [rehypeSanitize, sanitizeSchema],
  guardMathFencePlugin,
  [
    rehypeKatex,
    {
      strict: false,
      throwOnError: false,
      trust: false,
      maxSize: 10,
      maxExpand: 100,
    },
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
  return (tree: any, file: any) => {
    // 与 scanner 共享同一 per-render 尝试计数（file.data 在 remark→rehype 同一 VFile 上贯通），
    // 让 ```math 围栏与 $ / $$ route 一起受 MAX_FORMULAS_PER_MESSAGE 约束。
    const ctx = getMathContext(file);
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
            // ```math 是作者显式意图，不套用行内启发式 MATH_ISH_CHAR；只受非空 + 块长上限 +
            // 每条消息公式尝试数上限 + KaTeX 可解析且渲染产物不超上限约束。
            const candidate =
              tex.trim().length > 0 && tex.length <= MAX_BLOCK_MATH_LEN;
            const canAttempt =
              candidate && ctx.attempts < MAX_FORMULAS_PER_MESSAGE;
            if (canAttempt) ctx.attempts += 1;
            const ok = canAttempt && tryAcceptMath(ctx, tex, true);
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
  if (Array.isArray(node.children))
    return node.children.map(hastNodeText).join("");
  return "";
}

/**
 * `allowSingleDollarMath` 只放宽正文启发式，不能绕过接收端资源上限。remark-math 已在
 * CommonMark 转义前取得原始 TeX；这里统一限制数量、源码长度、KaTeX 可解析性与渲染产物大小。
 */
function guardRemarkMathPlugin() {
  return (tree: any, file: any) => {
    const source =
      typeof file?.value === "string" ? file.value : String(file ?? "");
    const ctx = getMathContext(file);
    const literalFallback = (node: any): any => {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      const raw =
        typeof start === "number" &&
        typeof end === "number" &&
        start >= 0 &&
        end >= start &&
        end <= source.length
          ? source.slice(start, end)
          : "";
      if (node.type === "inlineMath") {
        // inlineMath 不跨行，position slice 不含容器续行前缀，并能保留原始 `$` / `$$` 数量。
        return {
          type: "text",
          value: raw || `$${typeof node.value === "string" ? node.value : ""}$`,
        };
      }

      const firstLineEnd = raw.search(/[\r\n]/);
      const openerLine = firstLineEnd >= 0 ? raw.slice(0, firstLineEnd) : raw;
      // remark-math 把 opener 同行正文放进 meta；直接使用 node.value 会吞掉这些字节。
      if (firstLineEnd < 0) {
        return {
          type: "text",
          value: raw || `$$${typeof node.meta === "string" ? node.meta : ""}`,
        };
      }
      const value = typeof node.value === "string" ? node.value : "";
      const hasClosingFence = raw.trimEnd().endsWith("$$");
      return {
        type: "text",
        // 保留 opener 同行 meta、公式正文和 closing fence；不重新插入结构换行，避免
        // blockquote/list 的段落渲染把一次回退放大成多组空行。
        value: `${openerLine}${value}${hasClosingFence ? "$$" : ""}`,
      };
    };
    const visit = (node: any) => {
      if (!node || !Array.isArray(node.children)) return;
      node.children = node.children.map((child: any) => {
        if (child?.type === "inlineMath" || child?.type === "math") {
          const display = child.type === "math";
          const tex = typeof child.value === "string" ? child.value : "";
          const maxLength = display ? MAX_BLOCK_MATH_LEN : MAX_INLINE_MATH_LEN;
          const canAttempt =
            tex.trim().length > 0 &&
            tex.length <= maxLength &&
            ctx.attempts < MAX_FORMULAS_PER_MESSAGE;
          if (canAttempt) ctx.attempts += 1;
          if (canAttempt && tryAcceptMath(ctx, tex, display)) return child;
          return literalFallback(child);
        }
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
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
 *  - {@link escapeMaskPlugin} 必须排最前：它在 markdown 解析前把 CommonMark 会解码的反斜杠转义换成
 *    哨兵字符（代码 / HTML 区不动）。scanner 接受公式后把哨兵还原成原始 TeX 转义，拒绝后则还原成
 *    CommonMark 的字面字符；这样 `\%` / `\\` 等不会在交给 KaTeX 前丢失语义；
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

/** 文档 / 编辑器场景：放宽正文启发式，但仍统一执行公式数量、长度和渲染产物上限。 */
const mathRemarkPluginsSingleDollar: any[] = [
  rawHtmlAsTextPlugin,
  [remarkGfm, remarkGfmOptions],
  remarkMath,
  guardRemarkMathPlugin,
  remarkBreaks,
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
const TEX_SINGLE_CHAR_SUBSCRIPT =
  /(^|[^A-Za-z0-9])[A-Za-z0-9]_(\{|[A-Za-z0-9]|\\)/;
/** trust:false 下会被 KaTeX 作为 unsupported command 渲染并吞参数，必须整体回退源码。 */
const TRUST_GATED_TEX_CMD =
  /\\(?:href|url|includegraphics|htmlClass|htmlId|htmlStyle|htmlData)\b/;
/** 禁止用户公式定义/别名宏；否则很短的源码也能在 maxExpand 内膨胀成 MB 级同步渲染。 */
const MACRO_DEFINITION_TEX_CMD =
  /\\(?:def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand|global)\b/;
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

/** 独占 display fence 意图更强，但纯 prose 仍按字面保留，避免 KaTeX 静默吞掉空格。 */
function isAcceptableDisplayMath(inner: string): boolean {
  const core = inner.trim();
  return (
    core.length > 0 &&
    inner.length <= MAX_BLOCK_MATH_LEN &&
    (MATH_ISH_CHAR.test(core) || /[=+\-*/<>]/.test(core))
  );
}

/** 单条公式渲染后 HTML 长度上限（约 3.8KB 输入可膨胀到 >1MB / 3 万 DOM 节点）。 */
const MAX_RENDERED_MATH_LEN = 60000;
/** 单条消息累计 KaTeX HTML 预算，避免多个「各自合法」公式共同构造超大 DOM。 */
const MAX_RENDERED_MATH_PER_MESSAGE = 120000;
/** 单条消息公式尝试次数上限：解析失败也计数，避免恶意失败候选反复调用 KaTeX。 */
const MAX_FORMULAS_PER_MESSAGE = 32;
/** KaTeX 前置复杂度预算：行内输入短且频繁，保持严格限制。 */
const MAX_INLINE_MATH_COMPLEXITY_SCORE = 512;
/** display 允许常见多行推导；源码长度与渲染产物上限仍提供独立硬边界。 */
const MAX_DISPLAY_MATH_COMPLEXITY_SCORE = 2048;
const KATEX_LENGTH_CACHE_LIMIT = 256;

interface MathContext {
  attempts: number;
  renderedLength: number;
  budgetExhausted?: boolean;
  escapeMap?: Record<string, string>;
}

const katexLengthCache = new Map<string, number>();

function getMathContext(file: any): MathContext {
  const data = (file.data ||= {});
  const ctx: MathContext = (data.mathCtx ||= {
    attempts: 0,
    renderedLength: 0,
  });
  if (typeof ctx.renderedLength !== "number") ctx.renderedLength = 0;
  return ctx;
}

function exceedsMathComplexity(inner: string, displayMode: boolean): boolean {
  const maxScore = displayMode
    ? MAX_DISPLAY_MATH_COMPLEXITY_SCORE
    : MAX_INLINE_MATH_COMPLEXITY_SCORE;
  let score = Math.ceil(inner.length / 6);
  for (let i = 0; i < inner.length && score <= maxScore; i += 1) {
    const char = inner[i];
    if (char === "\\" || char === "&") score += 3;
    else if (char === "{" || char === "}") score += 2;
    else if (char === "^" || char === "_") score += 1;
  }
  return score > maxScore;
}

function getKatexRenderedLength(inner: string, displayMode: boolean): number {
  const key = `${displayMode ? "d" : "i"}\0${inner}`;
  const cached = katexLengthCache.get(key);
  if (cached !== undefined) {
    katexLengthCache.delete(key);
    katexLengthCache.set(key, cached);
    return cached;
  }
  let renderedLength = -1;
  try {
    renderedLength = katex.renderToString(inner, {
      ...KATEX_VALIDATE_OPTS,
      displayMode,
    }).length;
  } catch {
    renderedLength = -1;
  }
  katexLengthCache.set(key, renderedLength);
  if (katexLengthCache.size > KATEX_LENGTH_CACHE_LIMIT) {
    const oldest = katexLengthCache.keys().next().value;
    if (oldest !== undefined) katexLengthCache.delete(oldest);
  }
  return renderedLength;
}

/** KaTeX 预校验并扣减整条消息的累计渲染预算。 */
function tryAcceptMath(
  ctx: MathContext,
  inner: string,
  displayMode: boolean
): boolean {
  if (
    ctx.budgetExhausted ||
    exceedsMathComplexity(inner, displayMode) ||
    TRUST_GATED_TEX_CMD.test(inner) ||
    MACRO_DEFINITION_TEX_CMD.test(inner)
  ) {
    return false;
  }
  const renderedLength = getKatexRenderedLength(inner, displayMode);
  if (renderedLength < 0) return false;
  if (renderedLength > MAX_RENDERED_MATH_LEN) {
    return false;
  }
  if (ctx.renderedLength + renderedLength > MAX_RENDERED_MATH_PER_MESSAGE) {
    ctx.budgetExhausted = true;
    return false;
  }
  ctx.renderedLength += renderedLength;
  return true;
}

/**
 * display `$$…$$` 是否为「行锚定块」：opener 所在行 `$$` 前只有空白（行首），closer 所在行 `$$`
 * 后只有空白（行尾）。只有锚定块才当 display 公式；否则是跨软换行的普通 prose（`cost $$5 for\n…$$`），
 * 交回行内路径由 isAcceptableInlineMath 拦截，避免把 shell/prose 吞成 display math。
 */
function isAnchoredDisplay(
  source: string,
  openIdx: number,
  closeIdx: number
): boolean {
  if (openIdx < 0 || closeIdx < openIdx) return false;
  const lineStart = source.lastIndexOf("\n", openIdx - 1) + 1;
  const prefix = source.slice(lineStart, openIdx);
  // blockquote marker / indentation 属于容器前缀；其它源码说明 opener 实际位于行中。
  const openerAtLineStart = isContainerPrefixOnly(prefix);
  let b = closeIdx + 2;
  while (b < source.length && (source[b] === " " || source[b] === "\t")) b += 1;
  const closerAtLineEnd =
    b >= source.length || source[b] === "\n" || source[b] === "\r";
  return openerAtLineStart && closerAtLineEnd;
}

/** 行前缀只包含 blockquote marker 与水平空白；逐字符扫描避免嵌套量词指数回溯。 */
function isContainerPrefixOnly(prefix: string): boolean {
  for (let i = 0; i < prefix.length; i += 1) {
    const char = prefix[i];
    if (char !== " " && char !== "\t" && char !== ">") return false;
  }
  return true;
}

/** 某个 `$$` 是否可作为独占源码行的 display opener。 */
function isStandaloneDisplayOpener(source: string, openIdx: number): boolean {
  if (openIdx < 0) return false;
  const lineStart = source.lastIndexOf("\n", openIdx - 1) + 1;
  const prefix = source.slice(lineStart, openIdx);
  if (!isContainerPrefixOnly(prefix)) return false;
  let after = openIdx + 2;
  while (
    after < source.length &&
    (source[after] === " " || source[after] === "\t")
  ) {
    after += 1;
  }
  return (
    after >= source.length || source[after] === "\n" || source[after] === "\r"
  );
}

function collectSentinelCollisions(node: any, present: Set<string>): void {
  if (!node) return;
  for (const key of ["value", "url", "title", "alt", "identifier", "label"]) {
    const value = node[key];
    if (typeof value === "string") {
      for (const ch of value) present.add(ch);
    }
  }
  if (Array.isArray(node.data?.hChildren)) {
    node.data.hChildren.forEach((child: any) =>
      collectSentinelCollisions(child, present)
    );
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((child: any) =>
      collectSentinelCollisions(child, present)
    );
  }
}

function pickMathSentinels(
  source: string,
  tree: any,
  count: number
): string[] | null {
  const present = new Set(source);
  // 字符引用在 markdown parse 后才解码；碰撞检查必须覆盖解码后的 AST 字符。
  collectSentinelCollisions(tree, present);
  const sentinels: string[] = [];
  // 使用非 ASCII 的 Unicode 标点作为占位符，保持 CommonMark delimiter flanking 的
  // punctuation 分类不变，避免 `*\!*a` 一类正文被重分类成 emphasis。
  for (let cp = 0x00a1; cp <= 0x2e7f; cp += 1) {
    const ch = String.fromCharCode(cp);
    if (/\p{P}/u.test(ch) && !isAsciiPunctuation(ch) && !present.has(ch)) {
      sentinels.push(ch);
      if (sentinels.length === count) return sentinels;
    }
  }
  return null;
}

function isAutoLinkNode(node: any, source: string): boolean {
  if (node?.type !== "link") return false;
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  const raw =
    typeof start === "number" && typeof end === "number"
      ? source.slice(start, end)
      : "";
  return raw.startsWith("<") || /^(?:https?:\/\/|www\.)/i.test(raw);
}

/** 数学扫描与源码范围收集共同跳过的 mdast 子树。 */
function isMathScanExcludedSubtree(node: any, source: string): boolean {
  return (
    node?.type === "linkReference" ||
    node?.type === "imageReference" ||
    node?.type === "definition" ||
    isAutoLinkNode(node, source)
  );
}

/** 收集代码、原始 HTML 与自动链接区间；这些位置不应参与数学转义遮罩。 */
function collectLiteralRanges(
  node: any,
  ranges: Array<[number, number]>,
  source: string
): void {
  if (!node) return;
  const s = node.position?.start?.offset;
  const e = node.position?.end?.offset;
  if (
    node.type === "code" ||
    node.type === "inlineCode" ||
    node.type === "html" ||
    isAutoLinkNode(node, source)
  ) {
    if (typeof s === "number" && typeof e === "number") ranges.push([s, e]);
    return;
  }
  if (Array.isArray(node.children)) {
    for (const c of node.children) collectLiteralRanges(c, ranges, source);
  }
}

/** reference usage/definition 的反斜杠必须交给 CommonMark 一致解码，不能只遮罩 usage 一侧。 */
function collectReferenceRanges(
  node: any,
  ranges: Array<[number, number]>
): void {
  if (!node) return;
  if (
    node.type === "linkReference" ||
    node.type === "imageReference" ||
    node.type === "definition"
  ) {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (typeof start === "number" && typeof end === "number") {
      ranges.push([start, end]);
    }
    return;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectReferenceRanges(child, ranges);
  }
}

/**
 * 收集 mathScanPlugin 实际会处理的 mdast text 节点源码区间。范围收集必须使用同一边界，
 * 否则在 emphasis/link/code 等内联节点两侧配出的 `$` / `$$` 对，scanner 根本无法跨节点消费。
 */
function collectMathScanSourceRanges(
  node: any,
  ranges: Array<[number, number]>,
  source: string
): void {
  if (!node || isMathScanExcludedSubtree(node, source)) return;
  if (node.type === "text" && String(node.value ?? "").includes("$")) {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (typeof start === "number" && typeof end === "number") {
      ranges.push([start, end]);
    }
    return;
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectMathScanSourceRanges(child, ranges, source);
    }
  }
}

function isOffsetInRanges(
  offset: number,
  ranges: Array<[number, number]>
): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const [start, end] = ranges[mid];
    if (offset < start) high = mid - 1;
    else if (offset >= end) low = mid + 1;
    else return true;
  }
  return false;
}

function isEscapedAt(source: string, offset: number): boolean {
  let slashes = 0;
  for (let i = offset - 1; i >= 0 && source[i] === "\\"; i -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

/**
 * 线性预计算每个字符是否位于一个已闭合的 JSON-like `{}` / `[]` 容器内。
 *
 * 不能在每个 `$...$` 候选处用 lastIndexOf/indexOf 向两侧重新查找：大量引号候选会把
 * scanner 退化成 O(n²)。这里先收集匹配容器，再用差分数组生成 O(1) 查询表。
 */
function collectJsonContainerDepth(text: string): Int32Array {
  const depthDelta = new Int32Array(text.length + 1);
  const stack: Array<{ char: "{" | "["; offset: number }> = [];
  let quote: '"' | "'" | "" = "";
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    const apostropheInsideWord =
      char === "'" &&
      /[A-Za-z0-9]/.test(text[i - 1] ?? "") &&
      /[A-Za-z0-9]/.test(text[i + 1] ?? "");
    if ((char === '"' || char === "'") && !apostropheInsideWord) {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push({ char, offset: i });
      continue;
    }
    if (char !== "}" && char !== "]") continue;

    const expectedOpen = char === "}" ? "{" : "[";
    const open = stack[stack.length - 1];
    if (!open || open.char !== expectedOpen) continue;
    stack.pop();
    depthDelta[open.offset + 1] += 1;
    depthDelta[i] -= 1;
  }

  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    depth += depthDelta[i];
    depthDelta[i] = depth;
  }
  return depthDelta;
}

function isQuotedJsonValue(
  text: string,
  openOffset: number,
  closeOffset: number,
  delimiterLength: number,
  jsonContainerDepth?: Int32Array
): boolean {
  const before = openOffset > 0 ? text[openOffset - 1] : "";
  const after = text[closeOffset + delimiterLength] ?? "";
  if (
    !((before === '"' && after === '"') || (before === "'" && after === "'"))
  ) {
    return false;
  }
  return Boolean(
    jsonContainerDepth?.[openOffset] &&
      jsonContainerDepth[closeOffset + delimiterLength]
  );
}

/** 找出原始源码中可能由 scanner 处理的 `$...$` / `$$...$$` 内部区间。 */
function collectPotentialMathRanges(
  source: string,
  excludedRanges: Array<[number, number]>,
  scanRanges: Array<[number, number]>
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  let scanRangeIndex = 0;
  while (scanRangeIndex < scanRanges.length) {
    const [scanStart, scanEnd] = scanRanges[scanRangeIndex];
    if (i < scanStart) i = scanStart;
    if (i >= scanEnd) {
      scanRangeIndex += 1;
      continue;
    }
    if (
      source[i] !== "$" ||
      isOffsetInRanges(i, excludedRanges) ||
      isEscapedAt(source, i)
    ) {
      i += 1;
      continue;
    }
    const openLen = i + 1 < scanEnd && source[i + 1] === "$" ? 2 : 1;
    let close = -1;
    for (let j = i + openLen; j < scanEnd; j += 1) {
      if (isOffsetInRanges(j, excludedRanges)) continue;
      if (openLen === 1 && (source[j] === "\n" || source[j] === "\r")) break;
      if (
        openLen === 2 &&
        (source.startsWith("\n\n", j) || source.startsWith("\r\n\r\n", j))
      ) {
        break;
      }
      if (
        source[j] === "$" &&
        !isEscapedAt(source, j) &&
        (openLen === 1 || (j + 1 < scanEnd && source[j + 1] === "$"))
      ) {
        close = j;
        break;
      }
    }
    if (close >= 0) {
      ranges.push([i + openLen, close]);
      const preserveCloseAsDisplayOpener =
        openLen === 2 &&
        /[\r\n]/.test(source.slice(i + openLen, close)) &&
        !isAnchoredDisplay(source, i, close) &&
        isStandaloneDisplayOpener(source, close);
      // 与 scanTextForMath 保持一致：单 `$` 候选可能被正文守卫拒绝，此时 closer 仍可能是
      // 后续真实公式的 opener，因此只越过当前 opener；非锚定的多行 `$$` 候选也可能复用
      // 独占行 closer 作为下一段 display opener。其余 `$$` 完整候选整体消费。
      i =
        openLen === 1
          ? i + openLen
          : preserveCloseAsDisplayOpener
          ? close
          : close + openLen;
    } else {
      i += openLen;
    }
  }
  return ranges;
}

function isAsciiPunctuation(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

/**
 * 把源码里（代码 / HTML 外）会被 CommonMark 解码的转义换成哨兵。连续反斜杠按 pair 处理：
 * `\\` 是一个被转义的反斜杠，奇数个末尾反斜杠还可继续转义随后的 ASCII 标点。
 */
function maskMarkdownEscapes(
  source: string,
  ranges: Array<[number, number]>,
  referenceRanges: Array<[number, number]>,
  mathRanges: Array<[number, number]>,
  sentinels: string[]
): { masked: string; escapeMap: Record<string, string> } | null {
  const inLiteral = (off: number) => isOffsetInRanges(off, ranges);
  const inReference = (off: number) => isOffsetInRanges(off, referenceRanges);
  const escapedChars = new Map<string, string>();
  let nextSentinel = 0;
  const sentinelFor = (char: string): string | null => {
    const existing = escapedChars.get(char);
    if (existing) return existing;
    const sentinel = sentinels[nextSentinel];
    if (!sentinel) return null;
    nextSentinel += 1;
    escapedChars.set(char, sentinel);
    return sentinel;
  };
  const n = source.length;
  let out = "";
  let i = 0;
  while (i < n) {
    const dollarReference =
      source[i] === "&"
        ? source.slice(i, i + 16).match(/^&(?:#0*36|#x0*24|dollar);/i)?.[0]
        : undefined;
    if (dollarReference && !inLiteral(i)) {
      // 实体 `$` 只应恢复为字面字符，绝不能参与 scanner 的定界符配对。
      const dollarSentinel = sentinelFor("$");
      if (!dollarSentinel) return null;
      out += dollarSentinel;
      i += dollarReference.length;
      continue;
    }
    if (source[i] === "\\" && !inLiteral(i)) {
      let k = i;
      while (k < n && source[k] === "\\") k += 1;
      const runLen = k - i;
      const protectsDelimiter =
        runLen % 2 === 1 && source[k] === "$" && !inLiteral(k);
      const insideMath = isOffsetInRanges(i, mathRanges);
      if (inReference(i) || (!insideMath && !protectsDelimiter)) {
        // 公式候选外完全交给 CommonMark 原生解析，避免改变 emphasis / link 等正文结构。
        out += source.slice(i, k);
        i = k;
        continue;
      }
      const escapedSlash = sentinelFor("\\");
      if (!escapedSlash) return null;
      out += escapedSlash.repeat(Math.floor(runLen / 2));
      if (runLen % 2 === 1 && isAsciiPunctuation(source[k]) && !inLiteral(k)) {
        const escapedPunctuation = sentinelFor(source[k]);
        if (!escapedPunctuation) return null;
        out += escapedPunctuation;
        i = k + 1;
        continue;
      }
      if (runLen % 2 === 1) out += "\\";
      i = k;
      continue;
    }
    out += source[i];
    i += 1;
  }
  const escapeMap: Record<string, string> = {};
  for (const [char, sentinel] of escapedChars) escapeMap[sentinel] = char;
  return { masked: out, escapeMap };
}

/**
 * 在 markdown 解析前稳定保存 CommonMark 反斜杠转义，再用同一 processor 重解析整篇。公式节点恢复
 * 作者写入的原始 TeX（如 `\%`、`\\`）；普通文本恢复 CommonMark 解码后的字符。
 */
function escapeMaskPlugin(this: any) {
  const processor = this;
  return (tree: any, file: any) => {
    const source: string =
      typeof file?.value === "string" ? file.value : String(file ?? "");
    const hasDollarReference = /&(?:#0*36|#x0*24|dollar);/i.test(source);
    if (
      (source.indexOf("\\") === -1 && !hasDollarReference) ||
      typeof processor?.parse !== "function"
    ) {
      return;
    }
    // ASCII 标点至多 32 种；为每种转义字符分配一个源码 / AST 中都不存在的标点哨兵。
    const sentinels = pickMathSentinels(source, tree, 32);
    if (!sentinels) {
      // 没有足够安全哨兵时 fail closed，保留首次 parse 的 CommonMark 文本并禁用公式扫描。
      (file.data ||= {}).disableMathScan = true;
      return;
    }
    const ranges: Array<[number, number]> = [];
    collectLiteralRanges(tree, ranges, source);
    ranges.sort((a, b) => a[0] - b[0]);
    const referenceRanges: Array<[number, number]> = [];
    collectReferenceRanges(tree, referenceRanges);
    referenceRanges.sort((a, b) => a[0] - b[0]);
    const scanRanges: Array<[number, number]> = [];
    collectMathScanSourceRanges(tree, scanRanges, source);
    scanRanges.sort((a, b) => a[0] - b[0]);
    const mathRanges = collectPotentialMathRanges(source, ranges, scanRanges);
    const result = maskMarkdownEscapes(
      source,
      ranges,
      referenceRanges,
      mathRanges,
      sentinels
    );
    if (!result || result.masked === source) return;
    // 经 file.data 传递哨兵映射；其存在与否即「是否 mask 过」的 out-of-band 标记。
    (file.data ||= {}).mathEscapeMap = result.escapeMap;
    file.data.mathScanSource = result.masked;
    const reparsed = processor.parse(result.masked);
    tree.children = reparsed.children;
  };
}

/**
 * 把哨兵还原成 CommonMark 解码后的字面字符。仅在 {@link escapeMaskPlugin} 确实注入过哨兵时运行，
 * 避免无条件改写用户原文里的字符。还原覆盖所有可能承载哨兵的字符串字段：text /
 * inlineMath / math 的 `value`，以及 link / image / definition 的 `url` / `title` / `alt` /
 * `identifier` / `label`
 * （否则 `[go](…/a\$b)` 会把哨兵泄漏进 href）。
 */
function restoreSentinelPlugin() {
  return (tree: any, file: any) => {
    const escapeMap: Record<string, string> | undefined =
      file?.data?.mathEscapeMap;
    if (!escapeMap) return;
    const escapeEntries = Object.entries(escapeMap);
    const fix = (value: string) =>
      escapeEntries.reduce(
        (result, [sentinel, char]) => result.split(sentinel).join(char),
        value
      );
    const visit = (node: any) => {
      if (!node) return;
      for (const key of [
        "value",
        "url",
        "title",
        "alt",
        "identifier",
        "label",
      ]) {
        const v = node[key];
        if (
          typeof v === "string" &&
          escapeEntries.some(([sentinel]) => v.includes(sentinel))
        ) {
          node[key] = fix(v);
        }
      }
      if (Array.isArray(node.data?.hChildren))
        node.data.hChildren.forEach(visit);
      if (Array.isArray(node.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

/** 把 scanner 候选中的哨兵还原成作者原始 TeX 转义。 */
function restoreMathEscapes(
  value: string,
  escapeMap?: Record<string, string>
): string {
  if (!escapeMap) return value;
  return Object.entries(escapeMap).reduce(
    (result, [sentinel, char]) => result.split(sentinel).join(`\\${char}`),
    value
  );
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
 * 关键：行内候选被拒绝时只跳过本 opener（前移 openLen），后续 `$` 仍可开新候选——因此货币
 * `$100` 不会吃掉后面 `$E=mc^2$` 的定界符。完整的 `$$…$$` 候选被拒绝时则整体跳过；若跨行
 * 匹配到的 closer 本身是下一段独占行 opener，则保留给下一轮。text/source 两侧始终消费相同定界符。
 */
function scanTextForMath(
  text: string,
  ctx: MathContext,
  source: string,
  sourceStart?: number,
  sourceEnd?: number
): any[] {
  const out: any[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ type: "text", value: buf });
      buf = "";
    }
  };
  const n = text.length;
  const jsonContainerDepth =
    text.includes('"$') || text.includes("'$")
      ? collectJsonContainerDepth(text)
      : undefined;
  let i = 0;
  const hasSourceRange =
    typeof sourceStart === "number" &&
    typeof sourceEnd === "number" &&
    sourceStart >= 0 &&
    sourceEnd >= sourceStart &&
    sourceEnd <= source.length;
  const hasExactSourceMapping =
    hasSourceRange && source.slice(sourceStart, sourceEnd) === text;
  // 容器节点（如 blockquote）会让源码区间包含 `> ` 等 marker，无法按 text 下标直接映射。
  // 这类节点按候选顺序在自己的源码区间内查找；每一对 $$ 无论接受还是拒绝都必须消费，
  // 避免后续 display 候选错误复用更早的源码定界符。
  let sourceCursor = hasSourceRange ? sourceStart : -1;
  while (i < n) {
    if (text[i] !== "$") {
      buf += text[i];
      i += 1;
      continue;
    }
    const isDouble = text[i + 1] === "$";
    const openLen = isDouble ? 2 : 1;
    let sourceOpen = -1;
    if (isDouble && hasSourceRange) {
      sourceOpen = hasExactSourceMapping
        ? sourceStart + i
        : source.indexOf("$$", sourceCursor);
      if (
        sourceOpen < sourceStart ||
        sourceOpen >= sourceEnd ||
        source.slice(sourceOpen, sourceOpen + 2) !== "$$"
      ) {
        sourceOpen = -1;
      }
    }
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
      const inner = restoreMathEscapes(
        text.slice(i + openLen, close),
        ctx.escapeMap
      );
      const hasNewline = inner.indexOf("\n") !== -1;
      let sourceClose = -1;
      if (isDouble && sourceOpen >= 0) {
        if (hasExactSourceMapping) {
          sourceClose = sourceStart + close;
          if (source.slice(sourceClose, sourceClose + 2) !== "$$")
            sourceClose = -1;
        } else {
          sourceClose = source.indexOf("$$", sourceOpen + 2);
          if (sourceClose < 0 || sourceClose >= (sourceEnd ?? source.length))
            sourceClose = -1;
        }
      }
      const display =
        isDouble &&
        sourceOpen >= 0 &&
        sourceClose >= 0 &&
        isAnchoredDisplay(source, sourceOpen, sourceClose); // 用源码偏移判断，不能把 text-node 边界当行首/行尾
      const preserveCloseAsDisplayOpener =
        isDouble &&
        hasNewline &&
        !display &&
        sourceClose >= 0 &&
        isStandaloneDisplayOpener(source, sourceClose);
      let accept: boolean;
      if (display) {
        accept = isAcceptableDisplayMath(inner);
      } else {
        // 行内：定界符不能紧贴单词字符（挡 shell 多变量 `echo $X_1,$Y_2`——闭定界符后紧跟
        // 标识符，说明它其实是下一个 $var 的开定界符，而非公式收尾）。
        const before = i > 0 ? text[i - 1] : "";
        const after = close + openLen < n ? text[close + openLen] : "";
        const wordAdjacent =
          /[A-Za-z0-9]/.test(before) || /[A-Za-z0-9_]/.test(after);
        const quotedString = isQuotedJsonValue(
          text,
          i,
          close,
          openLen,
          jsonContainerDepth
        );
        accept =
          !wordAdjacent &&
          !quotedString &&
          isAcceptableInlineMath(inner, isDouble);
      }
      if (accept && ctx.attempts < MAX_FORMULAS_PER_MESSAGE) {
        ctx.attempts += 1;
        if (tryAcceptMath(ctx, inner, display)) {
          flush();
          out.push(makeMathNode(inner, display));
          i = close + openLen;
          if (isDouble && !hasExactSourceMapping) {
            sourceCursor =
              sourceClose >= 0
                ? sourceClose + openLen
                : sourceEnd ?? source.length;
          }
          continue;
        }
      }
      if (isDouble && !preserveCloseAsDisplayOpener) {
        // 完整 $$ 候选拒绝后也整体按字面消费；text/source 两侧始终越过同一对定界符。
        // 单 $ 仍只跳过 opener，保留 `$100 ... $E=mc^2$` 的后续公式识别能力。
        buf += text.slice(i, close + openLen);
        i = close + openLen;
        if (!hasExactSourceMapping) {
          sourceCursor =
            sourceClose >= 0
              ? sourceClose + openLen
              : sourceEnd ?? source.length;
        }
        continue;
      }
    }
    if (isDouble && !hasExactSourceMapping) {
      // 未形成候选时 text 侧只消费 opener；source 侧必须做完全相同的推进。
      sourceCursor =
        sourceOpen >= 0 ? sourceOpen + openLen : sourceEnd ?? source.length;
    }
    // 拒绝的行内候选：定界符按字面文本，只前移 openLen，后面的 `$` 仍能开新候选。
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
  return (tree: any, file: any) => {
    if (file?.data?.disableMathScan) return;
    const source: string =
      typeof file?.data?.mathScanSource === "string"
        ? file.data.mathScanSource
        : typeof file?.value === "string"
        ? file.value
        : String(file ?? "");
    // 与 ```math 围栏共享同一 per-render 尝试计数（见 guardMathFencePlugin）。
    const ctx = getMathContext(file);
    ctx.escapeMap = file.data.mathEscapeMap;
    const visit = (node: any) => {
      if (
        !node ||
        isMathScanExcludedSubtree(node, source) ||
        !Array.isArray(node.children)
      ) {
        return;
      }
      const next: any[] = [];
      for (const child of node.children) {
        if (
          child?.type === "text" &&
          typeof child.value === "string" &&
          child.value.indexOf("$") !== -1
        ) {
          const start = child.position?.start?.offset;
          const end = child.position?.end?.offset;
          const parts = scanTextForMath(
            child.value,
            ctx,
            source,
            typeof start === "number" ? start : undefined,
            typeof end === "number" ? end : undefined
          );
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

function areMarkdownContentPropsEqual(
  previous: Readonly<MarkdownContentProps>,
  next: Readonly<MarkdownContentProps>
): boolean {
  return (
    previous.content === next.content &&
    previous.isSend === next.isSend &&
    previous.isStreaming === next.isStreaming &&
    previous.onMentionClick === next.onMentionClick &&
    previous.enableMath === next.enableMath &&
    previous.allowSingleDollarMath === next.allowSingleDollarMath &&
    previous.enableMarkdown === next.enableMarkdown &&
    JSON.stringify(previous.mentions ?? []) ===
      JSON.stringify(next.mentions ?? []) &&
    JSON.stringify(previous.emojis ?? []) === JSON.stringify(next.emojis ?? [])
  );
}

const MemoizedMarkdownContent = React.memo(
  MarkdownContent,
  areMarkdownContentPropsEqual
);

export { MarkdownImage };
export default MemoizedMarkdownContent;
