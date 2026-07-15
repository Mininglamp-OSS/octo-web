import React, { useState } from "react";
import ReactMarkdown, { uriTransformer } from "react-markdown";
import remarkGfm from "remark-gfm";
import { attachmentIdFromSrc } from "./attachmentSrc";
import { useAuthedAttachmentUrl, triggerAuthedDownload } from "./useAuthedAttachment";
import "./markdown.css";

// react-markdown@8 默认只放行 http/https/mailto/tel，会把 mention:// 改写成 javascript:void(0)。
// 放行 mention:，其余仍走默认清洗（保住对用户输入的 XSS 防护）。
const transformLinkUri = (href: string) =>
  href.startsWith("mention://") ? href : uriTransformer(href);

/**
 * Inline markdown image whose src points at a loop attachment. Same problem as
 * the attachment card: the download endpoint is auth-only, so a native <img src>
 * carries no auth and 404/401s. Load the bytes through the authenticated client
 * (shared useAuthedAttachmentUrl), gated by the same inline-safe MIME whitelist
 * (an SVG attachment is never inlined — it would run in the document origin).
 * On failure (unsafe MIME or fetch error) fall back to a click-to-download that
 * also goes through the authed client — a native <a href> to the auth-only
 * endpoint would itself dead-link under octo-web.
 */
function MarkdownAttachmentImage({ id, filename, alt }: { id: string; filename: string; alt: string }) {
  const { url, failed } = useAuthedAttachmentUrl(id);
  const [busy, setBusy] = useState(false);

  if (failed) {
    // Not inline-safe (e.g. SVG) or fetch failed → click-to-download through the
    // authed client. NOT a native <a href={src} download>: src is the auth-only
    // endpoint and would dead-link under octo-web.
    const onClick = async (e: React.MouseEvent) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      await triggerAuthedDownload(id, filename);
      setBusy(false);
    };
    return (
      <a href="#" onClick={onClick} aria-busy={busy}>
        {alt || filename}
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
              // Prefer the markdown alt text as the download name; the URL's
              // last path segment is "download"/"content" (or a query), never a
              // real filename, so fall back to a stable generic instead.
              const name = alt || "attachment";
              return <MarkdownAttachmentImage id={id} filename={name} alt={alt ?? ""} />;
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
