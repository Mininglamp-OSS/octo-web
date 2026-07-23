import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { isSafeUrl } from "../../Utils/security";

const CHANGELOG_MARKDOWN_ELEMENTS = [
    "p", "strong", "em", "del", "ul", "ol", "li", "a", "code", "pre", "blockquote", "hr", "br",
    "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td", "input",
];

const changelogMarkdownComponents: any = {
    a: ({ href, children, node: _node, ...props }: any) => {
        if (typeof href !== "string" || !isSafeUrl(href)) {
            return <span>{children}</span>;
        }
        return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
    },
};

export interface ChangelogMarkdownProps {
    content: string;
}

/** 设置面板更新说明使用的受限 Markdown 渲染器。 */
export default function ChangelogMarkdown({ content }: ChangelogMarkdownProps) {
    return (
        <div className="wk-navrail__changelog-markdown">
            <ReactMarkdown
                skipHtml
                allowedElements={CHANGELOG_MARKDOWN_ELEMENTS}
                unwrapDisallowed
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeSanitize]}
                components={changelogMarkdownComponents}
            >
                {content || ""}
            </ReactMarkdown>
        </div>
    );
}
