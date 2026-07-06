import React, { useState, useCallback, createContext } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import { useI18n } from '@octo/base';
import CitationBadge, { CitationGroupBadge } from './CitationBadge';
import { CitationItem } from '../types/summary';

export interface CitationContextValue {
    activeKey: string | null;
    onBadgeClick: (key: string) => void;
    closeKey: (key: string) => void;
}

export const CitationContext = createContext<CitationContextValue>({
    activeKey: null,
    onBadgeClick: () => {},
    closeKey: () => {},
});

interface CitationTextProps {
    content: string;
    citations: CitationItem[];
}

const citationSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames || []), 'citation', 'citationgroup'],
    attributes: {
        ...defaultSchema.attributes,
        citation: ['index', 'badgekey'],
        citationgroup: ['indices', 'badgekey'],
    },
};

function remarkCitation(citations: CitationItem[]) {
    const getChannelId = (idx: number) => citations.find(c => c.index === idx)?.channel_id;

    return (tree: any) => {
        let occurrence = 0;
        visit(tree, 'text', (node: any, index: number | undefined, parent: any) => {
            if (!parent || index === undefined) return;
            const regex = /\[(\d+)\](?!\()/g;

            const matches: { start: number; end: number; citationIndex: number }[] = [];
            let match: RegExpExecArray | null;
            while ((match = regex.exec(node.value)) !== null) {
                matches.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    citationIndex: parseInt(match[1], 10),
                });
            }

            if (matches.length === 0) return;

            const groups: { start: number; end: number; indices: number[] }[] = [];
            let cur = { start: matches[0].start, end: matches[0].end, indices: [matches[0].citationIndex] };

            for (let i = 1; i < matches.length; i++) {
                const prev = matches[i - 1];
                const m = matches[i];
                const textBetween = node.value.slice(prev.end, m.start);
                const isAdjacent = textBetween.trim() === '';
                const prevChId = getChannelId(prev.citationIndex);
                const curChId = getChannelId(m.citationIndex);
                const sameChannel = !!prevChId && !!curChId && prevChId === curChId;

                if (isAdjacent && sameChannel) {
                    cur.end = m.end;
                    cur.indices.push(m.citationIndex);
                } else {
                    groups.push(cur);
                    cur = { start: m.start, end: m.end, indices: [m.citationIndex] };
                }
            }
            groups.push(cur);

            const parts: any[] = [];
            let textOffset = 0;

            for (const group of groups) {
                if (group.start > textOffset) {
                    parts.push({ type: 'text', value: node.value.slice(textOffset, group.start) });
                }

                if (group.indices.length === 1) {
                    const ci = group.indices[0];
                    parts.push({
                        type: 'citation',
                        data: {
                            hName: 'citation',
                            hProperties: { index: ci, badgekey: `c-${ci}-${occurrence++}` },
                        },
                        children: [],
                    });
                } else {
                    const firstIdx = group.indices[0];
                    const lastIdx = group.indices[group.indices.length - 1];
                    parts.push({
                        type: 'citationgroup',
                        data: {
                            hName: 'citationgroup',
                            hProperties: {
                                indices: group.indices.join(','),
                                badgekey: `cg-${firstIdx}-${lastIdx}-${occurrence++}`,
                            },
                        },
                        children: [],
                    });
                }

                textOffset = group.end;
            }

            if (textOffset < node.value.length) {
                parts.push({ type: 'text', value: node.value.slice(textOffset) });
            }

            parent.children.splice(index, 1, ...parts);
        });
    };
}

function markdownComponents(citations: CitationItem[]): any {
    return {
        citation: ({ node, ...props }: any) => {
            const idx = node?.properties?.index ?? props?.index;
            const badgeKey = node?.properties?.badgekey ?? props?.badgekey ?? `c-${idx}-fallback`;
            if (idx === undefined) return null;
            return <CitationBadge index={idx} citations={citations} badgeKey={badgeKey} />;
        },
        citationgroup: ({ node, ...props }: any) => {
            const indicesStr = node?.properties?.indices ?? props?.indices;
            const badgeKey = node?.properties?.badgekey ?? props?.badgekey ?? 'cg-fallback';
            if (!indicesStr) return null;
            const indices = String(indicesStr).split(',').map(Number);
            return <CitationGroupBadge indices={indices} citations={citations} badgeKey={badgeKey} />;
        },
        a: ({ href, children, ...props }: any) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
            </a>
        ),
    };
}

const CitationText: React.FC<CitationTextProps> = ({ content, citations }) => {
    const { t } = useI18n();
    const [activeKey, setActiveKey] = useState<string | null>(null);

    const onBadgeClick = useCallback((key: string) => {
        setActiveKey(prev => (prev === key ? null : key));
    }, []);

    const closeKey = useCallback((key: string) => {
        setActiveKey(prev => (prev === key ? null : prev));
    }, []);

    const normalized = content.trim();
    if (!normalized) {
        return <div className="summary-content-empty">{t("summary.content.empty")}</div>;
    }

    const hasCitations = citations && citations.length > 0;
    const citationPlugin = () => remarkCitation(citations);
    const remarkPlugins: any[] = hasCitations
        ? [remarkGfm, remarkBreaks, citationPlugin]
        : [remarkGfm, remarkBreaks];

    return (
        <CitationContext.Provider value={{ activeKey, onBadgeClick, closeKey }}>
            <div className="summary-content-markdown">
                <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={[[rehypeSanitize, citationSchema]]}
                    components={markdownComponents(citations)}
                >
                    {normalized}
                </ReactMarkdown>
            </div>
        </CitationContext.Provider>
    );
};

export default CitationText;
