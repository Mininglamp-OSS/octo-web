import React, { useState, useCallback, createContext } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { visit } from 'unist-util-visit';
import { useI18n } from '@octo/base';
import CitationBadge, { CitationGroupBadge, TeamCitationBadge } from './CitationBadge';
import { CitationItem, TeamCitationItem, MemberStatus } from '../types/summary';

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
    teamCitations?: TeamCitationItem[];
    /**
     * V5/§6.2：供 `[Pn]` 点击时在本地匹配作者单人报告用（详情页已拉取的
     * members）。不传时 `[Pn]` 退化为仅显示姓名。
     */
    members?: MemberStatus[];
    /**
     * 隐私收口：为 true 时只解析团队引用 `[Pn]`，把普通引用 `[n]` 当纯文本
     * （不渲染 CitationBadge / 不可点开看原文）。用于成员间互看他人报告 /
     * 团队总结的场景，避免暴露他人聊天原文。自己看自己（renderPersonalSummary）
     * 不传此开关，引用照常可点。
     */
    hidePlainCitations?: boolean;
    /** 历史版本详情只展示当时的 [Pn] 姓名，不用当前成员列表展开个人报告。 */
    disableTeamMemberPreview?: boolean;
}

const citationSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames || []), 'citation', 'citationgroup', 'teamcitation'],
    attributes: {
        ...defaultSchema.attributes,
        citation: ['index', 'badgekey'],
        citationgroup: ['indices', 'badgekey'],
        teamcitation: ['index', 'badgekey'],
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

// remarkTeamCitation turns [Pn] tokens into <teamcitation> nodes. Kept separate
// from remarkCitation: [Pn] is a distinct namespace pointing to a participant
// (person), not a message. No grouping/channel logic applies. The regex is kept
// byte-for-byte identical to the backend authority
// (internal/worker/meta_processor.go: teamCitationRe = `\[P(\d{1,3})\]`). Go RE2
// has no lookahead, so the backend cannot add (?!\(); team-summary body is
// LLM-generated plain text that never emits [P1](url), so matching the backend
// literally takes priority over guarding against markdown links.
function remarkTeamCitation() {
    return (tree: any) => {
        let occurrence = 0;
        visit(tree, 'text', (node: any, index: number | undefined, parent: any) => {
            if (!parent || index === undefined) return;
            const regex = /\[P(\d{1,3})\]/g;

            const matches: { start: number; end: number; teamIndex: number }[] = [];
            let match: RegExpExecArray | null;
            while ((match = regex.exec(node.value)) !== null) {
                matches.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    teamIndex: parseInt(match[1], 10),
                });
            }

            if (matches.length === 0) return;

            const parts: any[] = [];
            let textOffset = 0;
            for (const m of matches) {
                if (m.start > textOffset) {
                    parts.push({ type: 'text', value: node.value.slice(textOffset, m.start) });
                }
                parts.push({
                    type: 'teamcitation',
                    data: {
                        hName: 'teamcitation',
                        hProperties: { index: m.teamIndex, badgekey: `tc-${m.teamIndex}-${occurrence++}` },
                    },
                    children: [],
                });
                textOffset = m.end;
            }
            if (textOffset < node.value.length) {
                parts.push({ type: 'text', value: node.value.slice(textOffset) });
            }

            parent.children.splice(index, 1, ...parts);
        });
    };
}

function markdownComponents(
    citations: CitationItem[],
    teamCitations: TeamCitationItem[],
    members: MemberStatus[],
    disableTeamMemberPreview: boolean,
): any {
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
        teamcitation: ({ node, ...props }: any) => {
            const idx = node?.properties?.index ?? props?.index;
            const badgeKey = node?.properties?.badgekey ?? props?.badgekey ?? `tc-${idx}-fallback`;
            if (idx === undefined) return null;
            return (
                <TeamCitationBadge
                    index={idx}
                    teamCitations={teamCitations}
                    badgeKey={badgeKey}
                    members={members}
                    disableMemberPreview={disableTeamMemberPreview}
                />
            );
        },
        a: ({ href, children, ...props }: any) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
            </a>
        ),
    };
}

const CitationText: React.FC<CitationTextProps> = ({
    content,
    citations,
    teamCitations = [],
    members = [],
    hidePlainCitations = false,
    disableTeamMemberPreview = false,
}) => {
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

    const hasCitations = !hidePlainCitations && citations && citations.length > 0;
    const hasTeamCitations = teamCitations && teamCitations.length > 0;
    const citationPlugin = () => remarkCitation(citations);
    const remarkPlugins: any[] = [remarkGfm, remarkBreaks];
    if (hasCitations) remarkPlugins.push(citationPlugin);
    if (hasTeamCitations) remarkPlugins.push(remarkTeamCitation);

    return (
        <CitationContext.Provider value={{ activeKey, onBadgeClick, closeKey }}>
            <div className="summary-content-markdown">
                <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={[[rehypeSanitize, citationSchema]]}
                    components={markdownComponents(citations, teamCitations, members, disableTeamMemberPreview)}
                >
                    {normalized}
                </ReactMarkdown>
            </div>
        </CitationContext.Provider>
    );
};

export default CitationText;
