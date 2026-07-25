import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize from "rehype-sanitize";
import type { SummaryShareSnapshot } from "../../types/summary";
import "./index.css";

const MAX_RENDER_CHARS = 100_000;

function safeHref(value?: string): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
    } catch {
        return undefined;
    }
}

export interface SummaryShareContentProps {
    snapshot: SummaryShareSnapshot;
    locale: string;
    metaLabel: string;
    participantText: string;
    messageText: string;
}

export default function SummaryShareContent({ snapshot, locale, metaLabel, participantText, messageText }: SummaryShareContentProps) {
    const format = new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
    const formatDate = (value: string) => {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : format.format(date);
    };
    const start = formatDate(snapshot.time_range_start);
    const end = formatDate(snapshot.time_range_end);
    const range = !start || start === end ? start || end : `${start} – ${end}`;
    const metaItems = [range, participantText, messageText]
        .map((item) => item.trim())
        .filter(Boolean);
    const markdown = snapshot.content.slice(0, MAX_RENDER_CHARS);

    return (
        <article className="summary-share-content">
            {metaItems.length ? <div className="summary-share-content__meta" aria-label={metaLabel}>
                {metaItems.map((item, index) => <span key={`${index}-${item}`}>{item}</span>)}
            </div> : null}
            <div className="summary-share-content__markdown">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    rehypePlugins={[rehypeSanitize]}
                    components={{
                        a: ({ href, children }) => {
                            const safe = safeHref(href);
                            return safe
                                ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a>
                                : <span>{children}</span>;
                        },
                        img: ({ alt }) => <span>{alt || ""}</span>,
                    }}
                >
                    {markdown}
                </ReactMarkdown>
            </div>
        </article>
    );
}
