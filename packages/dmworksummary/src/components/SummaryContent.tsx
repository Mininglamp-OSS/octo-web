import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize from "rehype-sanitize";
import { Spin } from "@douyinfe/semi-ui";
import { useI18n } from "@octo/base";

interface SummaryContentProps {
    content: string;
    loading?: boolean;
}

const remarkPlugins: any[] = [remarkGfm, remarkBreaks];
const rehypePlugins: any[] = [rehypeSanitize];

const components: any = {
    a: ({ href, children, ...props }: any) => (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {children}
        </a>
    ),
};

const SummaryContent: React.FC<SummaryContentProps> = ({ content, loading }) => {
    const { t } = useI18n();
    const normalized = useMemo(() => content.trim(), [content]);

    if (loading) {
        return (
            <div className="summary-content-loading">
                <Spin />
            </div>
        );
    }

    if (!normalized) {
        return <div className="summary-content-empty">{t("summary.content.empty")}</div>;
    }

    return (
        <div className="summary-content-markdown">
            <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={components}
            >
                {normalized}
            </ReactMarkdown>
        </div>
    );
};

export default SummaryContent;
