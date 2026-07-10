import React from "react";
import ReactMarkdown, { uriTransformer } from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown.css";

// react-markdown@8 默认只放行 http/https/mailto/tel，会把 mention:// 改写成 javascript:void(0)。
// 放行 mention:，其余仍走默认清洗（保住对用户输入的 XSS 防护）。
const transformLinkUri = (href: string) =>
  href.startsWith("mention://") ? href : uriTransformer(href);

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
        }}
      >
        {content || ""}
      </ReactMarkdown>
    </div>
  );
}
