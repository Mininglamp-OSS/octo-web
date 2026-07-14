import React, { useEffect, useState } from "react";
import ReactMarkdown, { uriTransformer } from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchAttachmentBlob } from "../api/attachmentApi";
import { loadObjectUrl } from "./objectUrl";
import { canPreviewInline } from "./attachmentPreview";
import { attachmentIdFromSrc } from "./attachmentSrc";
import "./markdown.css";

// react-markdown@8 默认只放行 http/https/mailto/tel，会把 mention:// 改写成 javascript:void(0)。
// 放行 mention:，其余仍走默认清洗（保住对用户输入的 XSS 防护）。
const transformLinkUri = (href: string) =>
  href.startsWith("mention://") ? href : uriTransformer(href);

/**
 * Inline markdown image whose src points at a loop attachment. Same problem as
 * the attachment card: the download endpoint is auth-only, so a native <img src>
 * carries no auth and 404/401s. Load the bytes through the authenticated client
 * and wrap them in an object URL, gated by the same inline-safe MIME whitelist
 * (an SVG attachment is never inlined — it would run in the document origin).
 * On any failure (unsafe MIME, fetch error) fall back to a download link.
 */
function MarkdownAttachmentImage({ id, src, alt }: { id: string; src: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    return loadObjectUrl(id, {
      onLoad: setUrl,
      onError: () => setFailed(true),
    }, { fetchBlob: fetchAttachmentBlob, isInlineSafe: canPreviewInline });
  }, [id]);

  if (failed) {
    // Not inline-safe (e.g. SVG) or failed to load → downloadable link, never
    // a navigable same-origin blob preview.
    return (
      <a href={src} target="_blank" rel="noreferrer" download>
        {alt || src}
      </a>
    );
  }
  if (!url) {
    return <span className="loop-att loop-att--loading" aria-label={alt || undefined} />;
  }
  return <img src={url} alt={alt} />;
}

/** Loop Markdown 渲染：标题/列表/代码块/行内代码/链接/表格/引用等美化展示。 */
export default function LoopMarkdown({ content }: { content: string }) {
  return (
    <div className="loop-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        transformLinkUri={transformLinkUri}
        components={{
          a: ({ node, href, children, ...props }) => {
            // mention 链接 [@Label](mention://type/id):渲染为不可导航的高亮 chip(点击无跳转)。
            if (href && href.startsWith("mention://")) {
              return <span className="loop-mention">{children}</span>;
            }
            return <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>;
          },
          img: ({ node, src, alt, ...props }) => {
            // Loop attachment images need authenticated loading (see
            // MarkdownAttachmentImage); external / data: images load natively.
            const id = attachmentIdFromSrc(src);
            if (id) {
              return <MarkdownAttachmentImage id={id} src={src ?? ""} alt={alt ?? ""} />;
            }
            return <img src={src} alt={alt} {...props} />;
          },
        }}
      >
        {content || ""}
      </ReactMarkdown>
    </div>
  );
}
