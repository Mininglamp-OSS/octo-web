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
  /** 是否启用数学公式渲染（KaTeX），默认 false */
  enableMath?: boolean;
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
    // 放行 span 上的 hljs-* class（语法高亮 token）+ KaTeX 相关 class
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      [
        "className",
        /^hljs/,
        /^katex/,
        /^mord/,
        /^mbin/,
        /^mrel/,
        /^mopen/,
        /^mclose/,
        /^mpunct/,
        /^minner/,
        /^mop/,
        /^mfrac/,
        /^msqrt/,
        /^mroot/,
        /^mtable/,
        /^mtr/,
        /^mtd/,
        /^svg/,
        /^vlist/,
        /^strut/,
        /^frac-line/,
        /^delimsizing/,
        /^nulldelimiter/,
        /^reset-size/,
        /^sizing/,
        /^fontsize-ensurer/,
        /^base/,
      ],
    ],
    // 放行 KaTeX 相关元素的 class
    div: [...(defaultSchema.attributes?.div ?? []), ["className", /^katex/]],
    // 放行 KaTeX math 容器的 class
    math: [["className", /^katex/]],
    // 放行 KaTeX SVG 属性
    svg: [
      ["width"],
      ["height"],
      ["viewBox"],
      ["preserveAspectRatio"],
      ["style"],
    ],
    path: [["d"]],
    line: [["x1"], ["x2"], ["y1"], ["y2"]],
  },
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    // 放行 KaTeX 使用的 SVG 元素
    "svg",
    "path",
    "line",
    "math",
    "annotation",
    "semantics",
    "mrow",
    "mi",
    "mo",
    "mn",
    "msup",
    "msub",
    "mfrac",
    "mroot",
    "msqrt",
    "mtable",
    "mtr",
    "mtd",
  ],
};

/** 基础 rehype 插件（不含 KaTeX） */
const baseRehypePlugins: any[] = [
  [rehypeHighlight, { aliases: { json5: "json" }, ignoreMissing: true }],
  [rehypeSanitize, sanitizeSchema],
];

/** 含 KaTeX 的 rehype 插件 */
const mathRehypePlugins: any[] = [
  [rehypeHighlight, { aliases: { json5: "json" }, ignoreMissing: true }],
  [rehypeKatex, { strict: false, throwOnError: false }],
  [rehypeSanitize, sanitizeSchema],
];

/** 基础 remark 插件（不含 math） */
const baseRemarkPlugins: any[] = [remarkGfm, remarkBreaks];

/** 含 math 的 remark 插件 */
const mathRemarkPlugins: any[] = [remarkGfm, remarkBreaks, remarkMath];

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

const baseComponents: any = {
  a: ({ href, children, ...props }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
    </a>
  ),
  pre: ({ children, ...props }: any) => (
    <div className="wk-markdown-pre-wrapper">
      <pre {...props}>{children}</pre>
    </div>
  ),
  img: ({ src, alt }: any) => <MarkdownImage src={src} alt={alt} />,
};

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
  const resolved = WKApp.dataSource.commonDataSource.getImageURL(src);
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
  enableMath = false,
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
      ({ node, children, ...props }: any) =>
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
