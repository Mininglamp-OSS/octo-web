import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./markdown.css";

/** Loop Markdown 渲染：标题/列表/代码块/行内代码/链接/表格/引用等美化展示。 */
export default function LoopMarkdown({ content }: { content: string }) {
  return (
    <div className="loop-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => <a target="_blank" rel="noreferrer" {...props} />,
        }}
      >
        {content || ""}
      </ReactMarkdown>
    </div>
  );
}
