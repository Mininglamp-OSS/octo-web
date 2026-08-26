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
  name: string; // "@å¼ ä¸"ï¼å«@ç¬¦å·ï¼
  uid: string;
}

export interface EmojiInfo {
  key: string; // emoji ææ¬ keyï¼å¦ "[æåä½]" æ Unicode "ð"
  url: string; // å¾ç URL
}

interface MarkdownContentProps {
  content: string;
  isSend?: boolean;
  isStreaming?: boolean;
  mentions?: MentionInfo[];
  onMentionClick?: (uid: string) => void;
  emojis?: EmojiInfo[];
  /**
   * æ¯å¦å¯ç¨æ°å­¦å¬å¼æ¸²æï¼KaTeXï¼ï¼é»è®¤ trueã
   *
   * èå¤©æ¶æ¯é»è®¤è¯å« `$...$` è¡åä¸ `$$...$$` åçº§å¬å¼ï¼å¹¶ç¨åéå®å«ï¼{@link isAcceptableInlineMath}ï¼
   * è¿æ»¤ IM æ­£æè¯¯å¹éï¼éé¢/åé/JSON/è·¯å¾ï¼ãä¸ºä¿è¯æ­£æé¶èèï¼è¡ååéæ¯ iOS æ´ä¸¥ï¼
   * å« `/`ã`:`ãåå­æ¯åææ ãæå¤ä¸ªè¯å½¢ token ççæ®µææ­£æå¤çï¼çº¯ CJK ä¸ä¸å«çæ­£ TeX å½ä»¤
   * ç `$éé¢_x$` ä¸æ¸²æï¼ä½å«å½ä»¤ç `$v_{\text{å¹³å}}$` ç§å¸¸æ¸²æãéè¦æ¾å®½ï¼å¦æ ç¹æ®å­ç¬¦ç
   * ç®å `$a+b$`ï¼è§ {@link allowSingleDollarMath}ãæç¡®ä¸éè¦å¬å¼æ¶å¯ä¼  falseã
   */
  enableMath?: boolean;
  /**
   * æ¯å¦è·³è¿ math-ish å®å«ãæ æ¡ä»¶è¯å«ææ `$...$` / `$$...$$` ä¸ºå¬å¼ï¼é»è®¤ falseã
   *
   * èå¤©é»è®¤è·¯å¾ï¼falseï¼è¯å« `$...$` / `$$...$$`ï¼ä½å¯¹é½ iOS ç¨ math-ish å®å«è¿æ»¤ï¼
   * åªæåé¨å« `\ ^ _ { }` ä¹ä¸ççæ®µæå½å¬å¼æ¸²æï¼`$100`ã`$5-$10`ã`$HOME` ç­
   * éé¢/shell åºæ¯ä¿æåæãææ¡£/ç¼è¾å¨ç­ä½èæ¾å¼ä¹¦åå¬å¼çåºæ¯å¯ä¼  true å³æå®å«ï¼
   * è®© `$a+b$` è¿ç±»æ ç¹æ®å­ç¬¦çç®åå¬å¼ä¹æ¸²æã
   */
  allowSingleDollarMath?: boolean;
  /**
   * æ¯å¦å¯ç¨ Markdown è¯­æ³æ¸²æï¼é»è®¤ trueã
   * RichText(=14) MVP éçº¯ææ¬ï¼ä¼  false æ¶æçº¯ææ¬æ¸²æï¼ä¿çæ¢è¡/é¾æ¥/emoji/mentionï¼ï¼
   * ä¸è§£ææ é¢/åè¡¨/è¡¨æ ¼/ä»£ç åç­ markdown è¯­æ³ï¼é¿å web æ¸² markdown èç§»å¨ç«¯ä¸æ¸²çè·¨ç«¯ä¸ä¸è´ã
   */
  enableMarkdown?: boolean;
}

/**
 * å¨ GitHub é»è®¤ç½åååºç¡ä¸ï¼è¿½å  highlight.js éè¦ç class å±æ§ã
 * æ§è¡é¡ºåºï¼rehypeHighlight åçè²ï¼å  hljs-* classNameï¼ï¼
 * rehypeSanitize æåååºæ¸æ´ââç½ååéç hljs-* / language-* æçæ­£çæã
 * æ³¨æï¼react-markdown çè¾å¥æ¯ Markdown å­ç¬¦ä¸²ï¼remark ç´æ¥è§£ææå®å¨ ASTï¼
 * ä¸å­å¨æ³¨å¥ HTML çæºä¼ï¼æªå¼å¯ allowDangerousHtmlï¼ï¼æä»¥ highlight åè·ä¸ä¼å¼å¥é£é©ã
 */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // æ¾è¡ä»£ç åç language-* classï¼highlight.js å çï¼
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

/** åºç¡ rehype æä»¶ï¼ä¸å« KaTeXï¼ */
const baseRehypePlugins: any[] = [
  [rehypeHighlight, { aliases: { json5: "json" }, ignoreMissing: true }],
  [rehypeSanitize, sanitizeSchema],
];

const remarkGfmOptions = { singleTilde: false };

/**
 * KaTeX runs after sanitize: user-derived AST is cleaned first, then trusted KaTeX output keeps
 * its required inline styles and MathML structure. Resource limits prevent pathological formulas.
 *
 * â ï¸ Security invariant: because sanitize no longer runs *after* KaTeX, `trust: false` is the only
 * thing keeping a formula from emitting raw HTML (e.g. `\href`, `\htmlClass`). Do NOT flip it to
 * true on this shared message path â that would turn arbitrary chat text into an HTML-injection sink.
 *
 * Resource bounds (both below KaTeX defaults on purpose, since this renders untrusted chat text):
 *  - `maxSize: 10`  â clamps `\rule` / strut width+height so a single formula can't blow up layout.
 *  - `maxExpand: 100` â caps macro expansion against `\newcommand` bombs. Real formulas
 *    (`aligned`, `pmatrix`, chained arrows, ~40-term user-macro expansions) stay well under 100;
 *    raise it only if a legitimate formula is observed hitting the cap.
 */
const mathRehypePlugins: any[] = [
  [rehypeHighlight, { aliases: { json5: "json" }, ignoreMissing: true }],
  [rehypeSanitize, sanitizeSchema],
  [
    rehypeKatex,
    { strict: false, throwOnError: false, trust: false, maxSize: 10, maxExpand: 100 },
  ],
  katexErrorToTextPlugin,
];

/** æå hast èç¹ççº¯ææ¬åå®¹ã */
function hastNodeText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.value || "";
  if (Array.isArray(node.children)) return node.children.map(hastNodeText).join("");
  return "";
}

/**
 * KaTeX è§£æå¤±è´¥æ¶ï¼`throwOnError:false` ä¼æ¸²æ `.katex-error` çº¢å­ï¼æè¯¥èç¹éçº§æçº¯ææ¬ï¼
 * é¿åæ®éèå¤©éååºçº¢è²æ¥éãå±ç¤ºå¬å¼æºç åæï¼å»æçº¢è²æ ·å¼ï¼ï¼ä¸ãè¯¯å¹éä¸å¾åè½å°æ­£æã
 * çæ´ä½ç­ç¥ä¸è´ãå®å«å·²æ¡æç»å¤§å¤æ°æ­£æï¼æ­¤å¤åªåä½çè¢«å¤å®ä¸ºå¬å¼å´ KaTeX è§£æå¤±è´¥çå°æ°æåµã
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

/** åºç¡ remark æä»¶ï¼ä¸å« mathï¼ */
const baseRemarkPlugins: any[] = [
  rawHtmlAsTextPlugin,
  [remarkGfm, remarkGfmOptions],
  remarkBreaks,
];

/**
 * èå¤©é»è®¤è·¯å¾ï¼ä¸ä½¿ç¨ remark-mathï¼æ¹ç¨èªç çåæ¬¡å·¦å°å³æ«æå¨ {@link mathScanPlugin}
 * ç´æ¥å¨ mdast ææ¬èç¹ä¸è¯å«å¬å¼ãç¸æ¯ãremark-math è´ªå©ªéå¯¹ + äºåè½¬ä¹æºç åéè§£æãï¼
 * æ«æå¨è½ï¼
 *  - éä¸ªåéç¬ç«å¤å®ï¼æç»æ¶åªè·³è¿æ¬ openerï¼åé¢ç `$` ä»è½å¼æ°å¬å¼ï¼â `costs $100 and $E=mc^2$`
 *    éçå¬å¼ä»æ¸²æï¼ä¸ä¼è¢«åé¢çè´§å¸ `$` åæå®çç¬¦ï¼ï¼
 *  - åªæ¹å¨è¢«æ¥åçå¬å¼å­ä¸²ï¼å¶ä½ææ¬ï¼å«å®çç¬¦ / è¿å­ç¬¦ / åææ  / `${VAR}`ï¼100% åæ ·ä¿çï¼
 *  - å¯¹æ¯ä¸ªåéåç¨ KaTeX é¢æ ¡éªï¼è§£æå¤±è´¥å°±æ´ä½æå­é¢ææ¬ä¿çï¼è¿å®çç¬¦ï¼ï¼ä¸äº§ççº¢å­ãä¸ä¸¢å­ç¬¦ã
 * åªå¤ç `text` èç¹ï¼è¡åä»£ç  / ä»£ç åæ¯ç¬ç«èç¹ï¼å¤©ç¶ä¸åå½±åã
 * æ«æå¿é¡»æå¨ remarkBreaks ä¹åï¼å¦å breaks ä¼æåçº§ `$$\nâ¦\n$$` çè½¯æ¢è¡ææå¤ä¸ªèç¹ï¼æ«ä¸å°æ´æ®µã
 */
const mathRemarkPlugins: any[] = [
  rawHtmlAsTextPlugin,
  [remarkGfm, remarkGfmOptions],
  mathScanPlugin,
  remarkBreaks,
];

/** ææ¡£ / ç¼è¾å¨åºæ¯ï¼æ æ¡ä»¶è¯å«ææ `$...$` / `$$...$$`ï¼ä¸å å®å«ï¼ä½èæ¾å¼ä¹¦åå¬å¼ï¼ã */
const mathRemarkPluginsSingleDollar: any[] = [
  rawHtmlAsTextPlugin,
  [remarkGfm, remarkGfmOptions],
  remarkBreaks,
  remarkMath,
];

/** math-ish åé¨å­ç¬¦ï¼ä¸ iOS WKLaTeXPreprocessor.hasMathChar å®å¨ä¸è´ã */
const MATH_ISH_CHAR = /[\\^_{}]/;

/** CJK / 假名 / 谚文 / 全角标点（含 BMP 外汉字）：无命令的行内候选视为正文。 */
const CJK_CHAR =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}＀-￯]/u;

/** è¡åå¬å¼åéé¿åº¦ä¸éï¼å¯¹é½ iOS ç blast-radius æ§å¶ã */
const MAX_INLINE_MATH_LEN = 200;

/** å¤å­æ¯ TeX å½ä»¤ï¼å¦ \frac \eta \text \sum ââ åºç°å³è§ä¸ºæç¡®çå¬å¼æå¾ã */
const MULTI_LETTER_TEX_CMD = /\\[A-Za-z]{2,}/;
/** åå­æ¯åææ ï¼\a \b \tâ¦ï¼ï¼æ´å Windows è·¯å¾ / è½¬ä¹ï¼èéè¡å TeX å½ä»¤ã */
const SINGLE_LETTER_BACKSLASH = /\\[A-Za-z](?![A-Za-z])/;

/** ä¸æ ï¼`^` åæ¥ group / å­æ¯æ°å­ / å½ä»¤ã */
const TEX_SUPERSCRIPT = /\^(\{|[A-Za-z0-9]|\\)/;
/** åå­ç¬¦åºçä¸æ ï¼åºå­ç¬¦åæ¯éå­æ¯æ°å­ï¼æé¤ snake_case çå¤å­æ¯æ®µï¼ï¼`_` åæ¥ group / å­æ¯æ°å­ / å½ä»¤ã */
const TEX_SINGLE_CHAR_SUBSCRIPT = /(^|[^A-Za-z0-9])[A-Za-z0-9]_(\{|[A-Za-z0-9]|\\)/;
/** åçº§ display å¬å¼é¿åº¦ä¸éï¼è¿é¿ï¼å¦ 4.8KBï¼KaTeX æ¸²æèæ¶ææ¾ï¼è¶éæææ¬å¤çã */
const MAX_BLOCK_MATH_LEN = 4096;
/** KaTeX é¢æ ¡éª / æ¸²æéé¡¹ï¼ä¸ rehype-katex ä¸è´ï¼ä» throwOnError æå¼ç¨äºå¤å®ï¼ã */
const KATEX_VALIDATE_OPTS = {
  strict: false,
  throwOnError: true,
  trust: false,
  maxSize: 10,
  maxExpand: 100,
};

/** åéåé¨æ¯å¦å«çæ­£ç TeX æé ï¼å¤å­æ¯å½ä»¤ / ä¸æ  / åå­ç¬¦åºä¸æ ï¼ã */
function isTeXish(inner: string): boolean {
  return (
    MULTI_LETTER_TEX_CMD.test(inner) ||
    TEX_SUPERSCRIPT.test(inner) ||
    TEX_SINGLE_CHAR_SUBSCRIPT.test(inner)
  );
}

/**
 * è¡å `$â¦$` / `$$â¦$$` åéæ¯å¦æå¬å¼æ¥åãä»å«æä¸ª math-ish å­ç¬¦è¿è¿ä¸å¤ââIM æ­£æé
 * `_`ï¼snake_caseï¼ã`\`ï¼è·¯å¾ï¼ã`{}`ï¼`${VAR}` / JSONï¼ã`^`ã`:`ã`/` é½å¾å¸¸è§ãè¿éç¨
 * æ­£å TeX ç½åå + shell/path/prose è´åä¿¡å·åéæå³ï¼æ¯ iOS ç hasMathChar æ´ä¸¥ï¼ï¼
 *  - ä¸è·¨è¡ãé¿åº¦ â¤ 200ãéç©ºãå« math-ishï¼
 *  - æç»ä»¥ `{` å¼å¤´ï¼`${VAR}` / `${A}+${B}` è¿ç±» shell/CI/æ¨¡æ¿æå¼ï¼ï¼
 *  - æç»å« `/` `:`ï¼è·¯å¾ / URL / env / æ¯å¼ï¼ãåå­æ¯åææ  `\a`/`\b`ï¼è·¯å¾ / è½¬ä¹ï¼ï¼
 *  - å `$â¦$` è¦æ±å®çç¬¦ä¸¤ä¾§ç´§è´´éç©ºç½ï¼Pandocï¼ï¼`$$â¦$$` åè®¸ paddingï¼
 *  - å¿é¡»å«çæ­£ TeX æé ï¼æ å¤å­æ¯å½ä»¤æ¶åæç» CJK / â¥2 ä¸ªè¯å½¢ tokenï¼`for my var`ã`HOME DIR`ï¼ã
 * åèï¼æ å½ä»¤ççº¯ CJK è¡åå¬å¼ï¼`$éé¢_x$`ï¼ä¸æ¸²æï¼å«å½ä»¤ç `$v_{\text{å¹³å}}$` æ­£å¸¸æ¸²æã
 */
function isAcceptableInlineMath(inner: string, isDouble: boolean): boolean {
  if (/[\r\n]/.test(inner)) return false;
  if (inner.length > MAX_INLINE_MATH_LEN) return false;
  const core = inner.trim();
  if (core.length === 0) return false;
  if (core.startsWith("{")) return false; // ${VAR} / ${A}+${B} shell/æ¨¡æ¿æå¼
  if (!MATH_ISH_CHAR.test(core)) return false;
  if (/[/:]/.test(core)) return false; // è·¯å¾ / URL / env / æ¯å¼
  if (SINGLE_LETTER_BACKSLASH.test(core)) return false; // \a \b â è·¯å¾ / è½¬ä¹
  if (!isDouble && (/^\s/.test(inner) || /\s$/.test(inner))) return false; // Pandoc é»æ¥
  if (!isTeXish(core)) return false;
  if (!MULTI_LETTER_TEX_CMD.test(core)) {
    if (CJK_CHAR.test(core)) return false;
    const proseWords = core.replace(/\\[A-Za-z]+/g, " ").match(/[A-Za-z]{2,}/g);
    if (proseWords && proseWords.length >= 2) return false;
  }
  return true;
}

/** KaTeX è½å¦è§£æè¯¥å¬å¼ï¼é¢æ ¡éªï¼å¤±è´¥åæ´ä½æå­é¢ææ¬ä¿çï¼ä¸äº§ççº¢å­ãä¸ä¸¢å®çç¬¦ï¼ã */
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

/**
 * 找出 value 里「源码中被反斜杠转义」的 `$` 下标（value 空间）。CommonMark 已把 `\$` 折叠成 `$`，
 * 纯扫 value 会把用户的 in-band escape hatch（`literal \$x_1\$`）重新当成定界符。这里用文本节点
 * 源码切片与 value 并行游走还原转义信息；遇实体等无法对齐时返回 null（安全降级，不误标转义）。
 */
function findEscapedDollars(raw: string, value: string): Set<number> | null {
  const escaped = new Set<number>();
  const isPunct = (c: string) => /[!-/:-@[-`{-~]/.test(c);
  let ri = 0;
  let vi = 0;
  while (ri < raw.length && vi < value.length) {
    if (raw[ri] === "\\" && ri + 1 < raw.length && isPunct(raw[ri + 1])) {
      if (value[vi] !== raw[ri + 1]) return null;
      if (raw[ri + 1] === "$") escaped.add(vi);
      ri += 2;
      vi += 1;
    } else {
      if (value[vi] !== raw[ri]) return null;
      ri += 1;
      vi += 1;
    }
  }
  return vi === value.length ? escaped : null;
}

/** æé  mdast å¬å¼èç¹ï¼å¸¦ remark-rehype äº¤æ¥æéç hName/hProperties/hChildrenï¼ä¾ rehype-katex æ¸²æã */
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
 * åæ¬¡å·¦å°å³æ«æä¸æ®µææ¬ï¼è¯å« `$â¦$` / `$$â¦$$` å¬å¼ï¼è¿å mdast èç¹åºåï¼text / inlineMath / mathï¼ã
 * å³é®ï¼åéè¢«æç»æ¶åªè·³è¿æ¬ openerï¼åç§» openLenï¼ï¼åç»­ `$` ä»å¯å¼æ°åéââå æ­¤è´§å¸ `$100`
 * ä¸ä¼åæåé¢ `$E=mc^2$` çå®çç¬¦ï¼è¢«æç»çå®çç¬¦ä¸ææ¬ 100% åæ ·ä¿çã
 */
function scanTextForMath(
  text: string,
  escaped: Set<number> | null,
  ctx: { count: number }
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
  let i = 0;
  while (i < n) {
    if (text[i] !== "$" || escaped?.has(i)) {
      buf += text[i];
      i += 1;
      continue;
    }
    const isDouble = text[i + 1] === "$" && !escaped?.has(i + 1);
    const openLen = isDouble ? 2 : 1;
    let close = -1;
    let j = i + openLen;
    while (j < n) {
      if (isDouble) {
        if (
          text[j] === "$" &&
          text[j + 1] === "$" &&
          !escaped?.has(j) &&
          !escaped?.has(j + 1)
        ) {
          close = j;
          break;
        }
        if (text[j] === "\n" && text[j + 1] === "\n") break; // ä¸è·¨ç©ºè¡
      } else {
        if (text[j] === "\n") break; // å $ ä¸è·¨è¡
        if (text[j] === "$" && !escaped?.has(j)) {
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
        isDouble && hasNewline && isAnchoredDisplay(text, i, close); // $$ è·¨è¡ â display blockï¼å¦åè¡å
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
    // æç»ï¼å®çç¬¦æå­é¢ææ¬ï¼åªåç§» openLenï¼åé¢ç `$` ä»è½å¼æ°åé
    buf += text.slice(i, i + openLen);
    i += openLen;
  }
  flush();
  return out;
}

/**
 * èªç å¬å¼æ«ææä»¶ï¼æ¿ä»£èå¤©è·¯å¾ç remark-mathï¼ãéå mdastï¼å¯¹æ¯ä¸ªå« `$` ç `text` èç¹è·
 * {@link scanTextForMath}ï¼æè¯å«åºçå¬å¼ææ inlineMath/math èç¹ãå¿é¡»å¨ remarkBreaks ä¹åè¿è¡ã
 */
function mathScanPlugin() {
  return (tree: any, file: any) => {
    const source: string =
      typeof file?.value === "string" ? file.value : String(file ?? "");
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
          const s = child.position?.start?.offset;
          const e = child.position?.end?.offset;
          const raw =
            typeof s === "number" && typeof e === "number"
              ? source.slice(s, e)
              : null;
          const escaped =
            raw != null ? findEscapedDollars(raw, child.value) : null;
          const parts = scanTextForMath(child.value, escaped, ctx);
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
 * çº¯ææ¬æ¨¡å¼ï¼enableMarkdown=falseï¼æä»¶ï¼
 *   - remark åªä¿ç remarkBreaksï¼æ¢è¡è½¬ <br>ï¼ï¼ä¸å¯ç¨ gfmï¼é¿å markdown è¯­æ³è§£æï¼
 *   - rehype åªä¿ç sanitize ååºæ¸æ´ã
 * éå escapeMarkdown è½¬ä¹ï¼æç»æçº¯ææ¬æ¸²æï¼ä¸ç§»å¨ç«¯ãä¸æ¸² markdownãå¯¹é½ï¼ã
 */
const plainRemarkPlugins: any[] = [remarkBreaks];
const plainRehypePlugins: any[] = [[rehypeSanitize, sanitizeSchema]];

/**
 * è½¬ä¹ markdown è¯­æ³å­ç¬¦ï¼ä½¿åå®¹æçº¯ææ¬æ¸²æï¼
 * åææ è½¬ä¹å react-markdown æ¸²ææ¶ä¼è¿åä¸ºåå­ç¬¦ï¼ä¸æ¾ç¤ºåææ ï¼ï¼
 * ä»èç¦ç¨æ é¢/å ç²/åè¡¨/ä»£ç å/è¡¨æ ¼/é¾æ¥ç­ä¸å markdown è¯­æ³ã
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
 * é¢å¤ç Markdown åå®¹ï¼
 * æç¬å ä¸è¡ç --- / === è¡¥åååç©ºè¡ï¼é¿åè¢«è§£ææ setext æ é¢ï¼h2/h1ï¼ã
 * è·³è¿ fenced code blockï¼```...```ï¼åçåå®¹ï¼é¿åè¯¯å¤ç YAML ç­ä»£ç ä¸­çåéçº¿ã
 */
function normalizeContent(raw: string): string {
  // æå­ç¬¦ä¸²æ fenced code block ååï¼
  // å¥æ°ç´¢å¼ = ä»£ç ååå®¹ï¼ä¿æåæ ·ï¼ï¼å¶æ°ç´¢å¼ = æ®éææ¬ï¼éè¦å¤çï¼
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

  // åå¹¶ mention å emojiï¼æ key/name é¿åº¦éåºæåï¼é²æ­¢ç­ key æåå¹éï¼
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
 * elements) contribute nothing, which is fine â a real forward title/anchor is a plain string.
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
 * when the paragraph is exactly the forwarded-doc shape (leading bold title + a link â detected via
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
      // `typeof children === "string"` guard left `full` undefined â no `title` attribute â the
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
 * Markdown / RichText æ­£æåèå¾çï¼
 *  - url å®å¨æ ¡éªï¼ä» http/httpsï¼æ¡ data:/javascript:/file: ç­ï¼ï¼ä¸å®å¨åéçº§ä¸ºææ¬å ä½ï¼
 *  - ç¹å»å¤ç¨ ImageCell çå¤§å¾é¢è§ä¸åºé¨å·¥å·æ ï¼
 *  - src ç» datasource å¤çï¼ä¸å¶å®å¾çæ¸²æè·¯å¾è¡¥å¨ base URL ä¿æä¸è´ã
 */
const MarkdownImage: React.FC<{ src?: string; alt?: string }> = ({
  src,
  alt,
}) => {
  const [open, setOpen] = useState(false);
  if (!src) return null;
  // ç» datasource è§£æï¼è¡¥å¨ base URL / ç¸å¯¹è·¯å¾æ¹åï¼ï¼ä¸ ImageCell ä¸è´ã
  const resolved =
    WKApp.dataSource?.commonDataSource?.getImageURL?.(src) || src;
  // å®å¨æ ¡éªï¼è§£æåå¿é¡»æ¯ http/https ç»å¯¹å°åï¼å¦åéçº§ä¸ºçº¯ææ¬å ä½ï¼ç»ä¸æ¸²æã
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
 * éå½å¤ç React childrenï¼å°å¹é emoji/mention çææ¬èç¹æ¿æ¢ä¸ºå¯¹åºç React åç´ ã
 * å¨ ReactMarkdown æ¸²æåçç»ä»¶æ ä¸å·¥ä½ï¼ä¸ä¼ç ´åè¡¨æ ¼ç­åçº§ markdown ç»æã
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
      // KaTeX æ¸²æè¾åºï¼.katex / .katex-display åå¶åé¨ MathMLãapplication/x-tex
      // annotationï¼ä¸ååä¸å mention/emoji åæ®µï¼å¦åä¼æ mention <span>ï¼å« onClickï¼
      // æ emoji <img> æè¿ MathML ç <mtext> ä¸ TeX annotationï¼äº§çæ æ MathMLã
      // æ±¡æ copy-as-LaTeX ä¸æ éç¢è¯»å±ãå¬å¼åé¨ç `@åå­` / `[emoji]` åºä¿æå¬å¼åæã
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

  // æ ¹æ®æ¯å¦å¯ç¨æ°å­¦å¬å¼ / markdown éæ©æä»¶
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
