import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { isSafeUrl } from "../../../Utils/security";

/**
 * InteractiveCard octo/v1 受限 markdown 渲染。
 *
 * 契约（可见子集）：仅 **粗体** / *斜体* / 列表 / 链接。
 * **不复用** Text/MarkdownContent —— 后者启用 GFM 表格、代码块、标题、KaTeX、highlight，
 * 会渲染出 octo/v1 语义外的语法，造成 web 渲、移动端不渲的跨端不一致。
 *
 * 安全底座：
 *   - 不启用任何 remark-gfm / math / rehype-highlight / katex 插件；
 *   - `skipHtml` 丢弃原始 HTML（不开 allowDangerousHtml）；
 *   - sanitize 白名单收窄到 p/strong/em/ul/ol/li/a/br；
 *   - `allowedElements` 白名单二次限制（排除 img 等）；
 *   - 链接渲染前二次 `isSafeUrl` 校验，非法链接降级为纯文本；
 *   - 合法链接强制 `rel="noopener noreferrer"` + `target="_blank"`。
 */

/** sanitize 白名单：仅可见子集所需标签/属性/协议，未列出的一律清洗。 */
const CARD_MARKDOWN_TAGS = ["p", "strong", "em", "ul", "ol", "li", "a", "br"];

const cardSanitizeSchema = {
  tagNames: CARD_MARKDOWN_TAGS,
  attributes: {
    a: ["href", "title"],
  },
  // 链接协议 allowlist（sanitize 层）；组件层再用 isSafeUrl 二次校验。
  protocols: {
    href: ["http", "https"],
  },
  clobberPrefix: "wk-card-",
};

const cardRehypePlugins: any[] = [[rehypeSanitize, cardSanitizeSchema]];

const cardComponents: any = {
  // 丢弃 react-markdown 注入的 `node` 等非 DOM prop，避免透传到 span/a 触发 React 警告。
  a: ({ href, children, node: _node, ...props }: any) => {
    // 组件层二次校验：非 http/https 链接（javascript:/data:/octo:// 等）降级为纯文本。
    if (typeof href !== "string" || !isSafeUrl(href)) {
      return <span>{children}</span>;
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
};

export interface CardMarkdownProps {
  text: string;
}

/**
 * 渲染 octo/v1 受限 markdown。TextBlock.text 与 FactSet.title/value 共用。
 */
export function CardMarkdown({ text }: CardMarkdownProps): React.ReactElement {
  return (
    <span className="wk-interactive-card-md">
      <ReactMarkdown
        skipHtml
        allowedElements={CARD_MARKDOWN_TAGS}
        unwrapDisallowed
        remarkPlugins={[]}
        rehypePlugins={cardRehypePlugins}
        components={cardComponents}
      >
        {text || ""}
      </ReactMarkdown>
    </span>
  );
}

export default CardMarkdown;
