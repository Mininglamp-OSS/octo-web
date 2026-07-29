import React, { useCallback, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import Lightbox from "yet-another-react-lightbox";
import Download from "yet-another-react-lightbox/plugins/download";
import "yet-another-react-lightbox/styles.css";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";
import "./markdown.css";
import WKApp from "../../App";
import { isSafeUrl } from "../../Utils/security";
import { linkifySafeUrls } from "../../Utils/linkify";
import { downloadFile } from "../../Utils/download";
import { t } from "../../i18n";
import { getMentionRenderState } from "./mentionRenderState";
import {
  isForwardDocCard,
  middleEllipsizeUrl,
  shouldEllipsizeLinkText,
  type ParagraphChildKind,
} from "./forwardClamp";

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
  /** 是否启用数学公式渲染（KaTeX），默认 true */
  enableMath?: boolean;
  /**
   * 是否启用 Markdown 语法渲染，默认 true。
   * RichText(=14) MVP 锁纯文本：传 false 时按纯文本渲染（保留换行/链接/emoji/mention），
   * 不解析标题/列表/表格/代码块等 markdown 语法，避免 web 渲 markdown 而移动端不渲的跨端不一致。
   */
  enableMarkdown?: boolean;
}

/**
 * Sanitize 白名单。
 * 执行顺序：
 *   1. rehypeHighlight 先给代码块加 hljs-* / language-* className；
 *   2. rehypeSanitize 清洗用户内容，只保留可信的 class 与标签；
 *   3. rehypeKatex 在数学公式路径中最后运行，直接生成完整 KaTeX DOM。
 * 注意：
 *   - react-markdown 未开启 allowDangerousHtml，原始 HTML 会被 rawHtmlAsTextPlugin 转成文本；
 *   - KaTeX 输出不再经过二次 sanitize，因此本 schema 只需保留 rehype-katex 能识别的
 *     math 标记（language-math / math-inline / math-display），无需穷举 KaTeX class。
 */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // highlight.js 产生的 language-* 以及 remark-math 交给 rehype-katex 的标记。
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-/, /^hljs/, "math-inline", "math-display"],
    ],
    // highlight.js 产生的语法高亮 token class
    span: [...(defaultSchema.attributes?.span ?? []), ["className", /^hljs/]],
  },
};

/** 基础 rehype 插件（不含 KaTeX） */
const baseRehypePlugins: any[] = [
  [rehypeHighlight, { aliases: { json5: "json" }, ignoreMissing: true }],
  [rehypeSanitize, sanitizeSchema],
];

/** 含 KaTeX 的 rehype 插件：先清洗用户内容，再由 rehype-katex 生成可信 DOM */
const mathRehypePlugins: any[] = [
  [rehypeHighlight, { aliases: { json5: "json" }, ignoreMissing: true }],
  [rehypeSanitize, sanitizeSchema],
  [rehypeKatex, { strict: false, trust: false, maxSize: 10, maxExpand: 100 }],
];

/** 基础 remark 插件（不含 math） */
const baseRemarkPlugins: any[] = [
  rawHtmlAsTextPlugin,
  remarkGfm,
  remarkBreaks,
];

/** 含 math 的 remark 插件 */
const mathRemarkPlugins: any[] = [
  rawHtmlAsTextPlugin,
  remarkGfm,
  remarkBreaks,
  [remarkMath, { singleDollarTextMath: false }],
];

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
 * 1. 把独占一行的 --- / === 补充前后空行，避免被解析成 setext 标题（h2/h1）。
 * 2. 把多行 $$\n...\n$$ 合并为单行 $$...$$，避免 remark-math@6 与
 *    mdast-util-from-markdown@1（react-markdown@8 使用的版本）的 API
 *    不兼容导致 flow-math 解析崩溃（TypeError: Cannot read properties of
 *    undefined (reading 'mathFlowInside')）。单行 $$...$$ 走 text-math
 *    路径不触发该 bug，KaTeX 仍正常渲染。
 * 跳过 fenced code block（```...```）内的内容，避免误处理。
 */
function normalizeContent(raw: string): string {
  // 把字符串按 fenced code block 切分：
  // 奇数索引 = 代码块内容（保持原样），偶数索引 = 普通文本（需要处理）
  const parts = raw.split(/(```[\s\S]*?```)/g);
  const processed = parts.map((part, i) => {
    if (i % 2 === 1) return part;
    return part
      // 合并多行 $$ 块为单行，绕过 flow-math 崩溃
      .replace(/\$\$\n([\s\S]*?)\n\$\$/g, (_, content) => `$$${content.replace(/\n/g, " ")}$$`)
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

const baseComponents: any = {
  a: ({ href, children, ...props }: any) => {
    // AC-13b (feature #511): middle-ellipsize the DISPLAY text only when it is itself a long bare
    // URL (visible text === href). A normal `[title](link)` keeps its title untouched; the href is
    // never modified. `title` tooltip carries the full URL so hover/copy still gets the whole link.
    const text =
      typeof children === "string"
        ? children
        : Array.isArray(children) && children.length === 1 && typeof children[0] === "string"
          ? (children[0] as string)
          : null;
    if (text != null && shouldEllipsizeLinkText(text, href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" title={text} {...props}>
          {middleEllipsizeUrl(text)}
        </a>
      );
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
  p: ({ node: _node, children, ...props }: any) => renderParagraph(children, props),
  pre: ({ children, ...props }: any) => (
    <div className="wk-markdown-pre-wrapper">
      <pre {...props}>{children}</pre>
    </div>
  ),
  img: ({ src, alt }: any) => <MarkdownImage src={src} alt={alt} />,
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
function renderParagraph(children: React.ReactNode, props: any): React.ReactElement {
  const arr = React.Children.toArray(children);
  const kinds: ParagraphChildKind[] = arr.map((c) => {
    if (typeof c === "string") return { text: c };
    if (React.isValidElement(c)) {
      const type = (c as React.ReactElement).type as any;
      const cprops = (c.props ?? {}) as any;
      // Carry the visible text of bold/link runs so the detector can require the link label to
      // equal the bold title (the forward card duplicates the title as its anchor text).
      if (type === "strong" || type === "b") return { isStrong: true, content: plainText(cprops.children) };
      if (type === "br") return { isBreak: true };
      if (cprops.href != null || type === baseComponents.a) return { isLink: true, content: plainText(cprops.children) };
    }
    return {};
  });
  if (!isForwardDocCard(kinds)) {
    return <p {...props}>{children}</p>;
  }
  // Clone the leading <strong> to carry the full-title tooltip + clamp class.
  const clamped = arr.map((c, i) => {
    if (React.isValidElement(c) && ((c.type as any) === "strong" || (c.type as any) === "b")) {
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
        className: `${cprops?.className ?? ""} wk-markdown-forward-title`.trim(),
        title: full,
      });
    }
    return c;
  });
  return (
    <p {...props} className={`${props?.className ?? ""} wk-markdown-forward-card`.trim()}>
      {clamped}
    </p>
  );
}

/**
 * Markdown / RichText 正文内联图片：
 *  - url 安全校验（仅 http/https，挡 data:/javascript:/file: 等），不安全则降级为文本占位；
 *  - 点击打开 Lightbox 大图预览（与 ImageCell 行为一致，带下载）；
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
      <Lightbox
        open={open}
        close={() => setOpen(false)}
        slides={[{ src: resolved, alt: alt || "" }]}
        plugins={[Download]}
        download={{
          download: ({ slide }) => {
            if (slide?.src) {
              downloadFile(slide.src, alt || "image.png");
            }
          },
        }}
        carousel={{ finite: true }}
        controller={{ closeOnBackdropClick: true }}
        render={{
          buttonPrev: () => null,
          buttonNext: () => null,
        }}
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
    if (React.isValidElement(child) && (child.props as any).children != null) {
      return React.cloneElement(
        child as React.ReactElement<any>,
        {},
        processTextChildren(
          (child.props as any).children,
          mentions,
          emojis,
          onMentionClick,
          isSend
        )
      );
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
    if (!hasTokens) return baseComponents;
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
      ({ node, children, ordered, checked, index, siblingCount, ...props }: any) =>
        React.createElement(Tag, props, process(children));
    return {
      ...baseComponents,
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
  ]);

  // 根据是否启用数学公式 / markdown 选择插件
  const remarkPlugins = !enableMarkdown
    ? plainRemarkPlugins
    : enableMath
    ? mathRemarkPlugins
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
