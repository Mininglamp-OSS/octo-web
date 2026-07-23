import React, { useMemo } from "react";
import type { CitationItem, MemberStatus, TeamCitationItem } from "../../types/summary";
import CitationText from "../../components/CitationText";
import "./index.css";

export interface SummaryOutlineItem { id: string; level: 2 | 3; text: string }

export function extractSummaryOutline(markdown: string): SummaryOutlineItem[] {
    const counts = new Map<string, number>();
    const result: SummaryOutlineItem[] = [];
    let fenced = false;
    for (const line of markdown.split(/\r?\n/)) {
        if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
        if (fenced) continue;
        const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
        if (!match) continue;
        const text = match[2]
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
            .replace(/[*_~`]/g, "")
            .trim();
        if (!text) continue;
        const base = text.toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "") || "section";
        const occurrence = counts.get(base) || 0;
        counts.set(base, occurrence + 1);
        result.push({ id: occurrence ? `${base}-${occurrence + 1}` : base, level: match[1].length as 2 | 3, text });
    }
    return result;
}

interface Props {
    content: string;
    citations?: CitationItem[];
    teamCitations?: TeamCitationItem[];
    members?: MemberStatus[];
    hidePlainCitations?: boolean;
    showOutline?: boolean;
    outlineLabel: string;
}

export default function SummaryMarkdownReader({ content, citations = [], teamCitations = [], members = [], hidePlainCitations = false, showOutline = true, outlineLabel }: Props) {
    const outline = useMemo(() => extractSummaryOutline(content), [content]);
    return <div className="summary-markdown-reader">
        <article className="summary-markdown-reader__content">
            <CitationText content={content} citations={citations} teamCitations={teamCitations} members={members} hidePlainCitations={hidePlainCitations} headingIds={outline.map(item => item.id)} />
        </article>
        {showOutline && outline.length > 0 ? <nav className="summary-markdown-reader__outline" aria-label={outlineLabel}>
            <div className="summary-markdown-reader__outline-title">{outlineLabel}</div>
            {outline.map((item, index) => <a key={item.id} className={`summary-markdown-reader__outline-link summary-markdown-reader__outline-link--h${item.level}`} href={`#${item.id}`}>
                <span className="summary-markdown-reader__outline-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <span>{item.text}</span>
            </a>)}
        </nav> : null}
    </div>;
}
