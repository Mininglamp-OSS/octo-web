import React, { useContext, useMemo } from 'react';
import { Popover } from '@douyinfe/semi-ui';
import { i18n, useI18n } from '@octo/base';
import { Channel, ChannelTypeGroup, ChannelTypePerson } from 'wukongimjssdk';
import WKApp from '@octo/base/src/App';
import { ShowConversationOptions } from '@octo/base/src/EndpointCommon';
import { ChannelTypeCommunityTopic } from '@octo/base/src/Service/Const';
import CitationText, { CitationContext } from './CitationText';
import { CitationItem, CitationContextMessage, TeamCitationItem, MemberStatus } from '../types/summary';

interface CitationBadgeProps {
    index: number;
    citations: CitationItem[];
    badgeKey: string;
}

interface CitationGroupBadgeProps {
    indices: number[];
    citations: CitationItem[];
    badgeKey: string;
}

function formatTime(iso: string): string {
    try {
        return i18n.format.dateTime(iso, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
        return iso;
    }
}

function resolveChannelType(channelType?: number) {
    if (channelType === 1) return ChannelTypePerson;
    if (channelType === 5) return ChannelTypeCommunityTopic;
    return ChannelTypeGroup;
}

const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'rgba(22, 119, 255, 0.13)',
    color: '#1677ff',
    borderRadius: 4,
    padding: '0 4px',
    fontSize: 11,
    cursor: 'pointer',
    marginLeft: 2,
    lineHeight: '16px',
    verticalAlign: 'super',
};

const contextMsgStyle: React.CSSProperties = {
    padding: '4px 8px',
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
    lineHeight: 1.5,
    wordBreak: 'break-word',
};

const citedMsgStyle: React.CSSProperties = {
    padding: '4px 8px',
    borderLeft: '3px solid #1677ff',
    fontSize: 13,
    lineHeight: 1.5,
    wordBreak: 'break-word',
};

interface MergedMessage {
    sender: string;
    content: string;
    sent_at: string;
    message_seq?: number;
    cited: boolean;
    citation_index?: number;
}

function mergeGroupMessages(groupCitations: CitationItem[]): MergedMessage[] {
    const all: MergedMessage[] = [];
    for (const c of groupCitations) {
        if (c.context_before) {
            for (const msg of c.context_before) {
                all.push({ sender: msg.sender, content: msg.content, sent_at: msg.sent_at, message_seq: msg.message_seq, cited: false });
            }
        }
        all.push({
            sender: c.sender,
            content: c.content,
            sent_at: c.sent_at,
            message_seq: c.message_seq,
            cited: true,
            citation_index: c.index,
        });
        if (c.context_after) {
            for (const msg of c.context_after) {
                all.push({ sender: msg.sender, content: msg.content, sent_at: msg.sent_at, message_seq: msg.message_seq, cited: false });
            }
        }
    }

    const seen = new Map<string, MergedMessage>();
    for (const msg of all) {
        const key = msg.message_seq != null
            ? `seq:${msg.message_seq}`
            : `${msg.sender}\0${msg.content}\0${msg.sent_at}`;
        const existing = seen.get(key);
        if (!existing || (msg.cited && !existing.cited)) {
            seen.set(key, msg);
        }
    }

    const result = Array.from(seen.values());
    result.sort((a, b) => {
        if (a.message_seq != null && b.message_seq != null) return a.message_seq - b.message_seq;
        return new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime();
    });
    return result;
}

function ContextMessages({ messages }: { messages?: CitationContextMessage[] }) {
    if (!messages?.length) return null;
    return (
        <>
            {messages.map((msg, i) => (
                <div key={i} style={contextMsgStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 500 }}>{msg.sender}</span>
                        <span style={{ fontSize: 11, color: '#bbb' }}>{formatTime(msg.sent_at)}</span>
                    </div>
                    <div>{msg.content}</div>
                </div>
            ))}
        </>
    );
}

function JumpLink({ citation, badgeKey, closeKey }: { citation: CitationItem; badgeKey: string; closeKey: (key: string) => void }) {
    const { t } = useI18n();
    if (!citation.channel_id || !citation.message_seq || citation.channel_type == null) return null;
    return (
        <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #f0f0f0', textAlign: 'right' }}>
            <span
                style={{ color: '#1677ff', fontSize: 12, cursor: 'pointer' }}
                onClick={(e) => {
                    e.stopPropagation();
                    closeKey(badgeKey);
                    let channelId = citation.channel_id!;
                    const channelType = resolveChannelType(citation.channel_type);
                    if (channelType === ChannelTypePerson && channelId.includes('@')) {
                        const loginUid = WKApp.loginInfo.uid;
                        channelId = channelId.split('@').find(id => id !== loginUid) || channelId;
                    }
                    const channel = new Channel(channelId, channelType);
                    const opts = new ShowConversationOptions();
                    opts.initLocateMessageSeq = citation.message_seq;
                    WKApp.endpoints.showConversation(channel, opts);
                }}
            >
                {t("summary.citation.jumpToOriginal")}
            </span>
        </div>
    );
}

const CitationBadge: React.FC<CitationBadgeProps> = ({ index, citations, badgeKey }) => {
    const { t } = useI18n();
    const { activeKey, onBadgeClick, closeKey } = useContext(CitationContext);
    const citation = citations.find(c => c.index === index);

    if (!citation) {
        return <sup style={badgeStyle}>[{index}]</sup>;
    }

    const isVisible = activeKey === badgeKey;

    return (
        <Popover
            trigger="custom"
            visible={isVisible}
            position="top"
            showArrow
            onClickOutSide={() => closeKey(badgeKey)}
            content={
                <div style={{ maxWidth: 340, padding: '8px 4px', maxHeight: 400, overflowY: 'auto' }}>
                    <ContextMessages messages={citation.context_before} />
                    <div style={citedMsgStyle}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{citation.sender}</span>
                            <span style={{ fontSize: 12, color: '#999' }}>{formatTime(citation.sent_at)}</span>
                        </div>
                        {citation.source && (
                            <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                                {t("summary.citation.source", { values: { source: citation.source } })}
                            </div>
                        )}
                        <div style={{ fontSize: 13, lineHeight: 1.5 }}>{citation.content}</div>
                    </div>
                    <ContextMessages messages={citation.context_after} />
                    <JumpLink citation={citation} badgeKey={badgeKey} closeKey={closeKey} />
                </div>
            }
        >
            <sup className="citation-badge" style={badgeStyle} onClick={() => onBadgeClick(badgeKey)}>[{index}]</sup>
        </Popover>
    );
};

export const CitationGroupBadge: React.FC<CitationGroupBadgeProps> = ({ indices, citations, badgeKey }) => {
    const { activeKey, onBadgeClick, closeKey } = useContext(CitationContext);

    const first = indices[0];
    const last = indices[indices.length - 1];
    const label = `${first}-${last}`;

    const indicesKey = indices.join(',');
    const groupCitations = useMemo(
        () => indicesKey.split(',').map(Number).map(i => citations.find(c => c.index === i)).filter((c): c is CitationItem => !!c),
        [indicesKey, citations]
    );
    const mergedMessages = useMemo(() => mergeGroupMessages(groupCitations), [groupCitations]);

    if (groupCitations.length === 0) {
        return <sup style={badgeStyle}>[{label}]</sup>;
    }

    const isVisible = activeKey === badgeKey;
    const firstCitation = groupCitations[0];

    return (
        <Popover
            trigger="custom"
            visible={isVisible}
            position="top"
            showArrow
            onClickOutSide={() => closeKey(badgeKey)}
            content={
                <div style={{ maxWidth: 360, padding: '8px 4px', maxHeight: 400, overflowY: 'auto' }}>
                    {mergedMessages.map((msg, i) => (
                        <div key={msg.message_seq ?? i} style={msg.cited ? citedMsgStyle : contextMsgStyle}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                <span style={{ fontWeight: msg.cited ? 600 : 500, fontSize: msg.cited ? 13 : 12 }}>{msg.sender}</span>
                                <span style={{ fontSize: 11, color: msg.cited ? '#999' : '#bbb' }}>{formatTime(msg.sent_at)}</span>
                            </div>
                            <div style={{ fontSize: msg.cited ? 13 : 12, lineHeight: 1.5 }}>{msg.content}</div>
                        </div>
                    ))}
                    <JumpLink citation={firstCitation} badgeKey={badgeKey} closeKey={closeKey} />
                </div>
            }
        >
            <sup className="citation-badge" style={badgeStyle} onClick={() => onBadgeClick(badgeKey)}>[{label}]</sup>
        </Popover>
    );
};

interface TeamCitationBadgeProps {
    index: number;
    teamCitations: TeamCitationItem[];
    badgeKey: string;
    /**
     * V5/§6.2：详情页已拉取的全体成员（已提交者带 content+citations）。
     * `[Pn]` 点击时以此在本地匹配作者单人报告，不发新请求。
     */
    members?: MemberStatus[];
    /** 历史版本详情不应使用当前成员列表展开个人报告。 */
    disableMemberPreview?: boolean;
}

const memberRowStyle: React.CSSProperties = {
    padding: '4px 8px',
    borderLeft: '3px solid #1677ff',
    fontSize: 13,
    lineHeight: 1.5,
    wordBreak: 'break-word',
};

// TeamCitationBadge renders a clickable [Pn] reference (V5/§6.2). A team
// citation points to a PERSON (participant). On click we match that person in
// the already-fetched members list and surface their single-person report
// (content + its own [n] citations) inside the popover — no new request.
// Match priority: personal_result_id (convenience field) is NOT carried on
// MemberStatus, so the authoritative join key is user_id (§6.2/Q4). The popover
// degrades to name-only when the member has not submitted (no content yet).
export const TeamCitationBadge: React.FC<TeamCitationBadgeProps> = ({
    index,
    teamCitations,
    badgeKey,
    members = [],
    disableMemberPreview = false,
}) => {
    const { t } = useI18n();
    const { activeKey, onBadgeClick, closeKey } = useContext(CitationContext);
    const citation = teamCitations.find(c => c.index === index);

    if (!citation) {
        return <sup style={badgeStyle}>[P{index}]</sup>;
    }

    // 优先用 user_id 在 members 里匹配同一成员（§6.2/Q4）。
    // 显式注解：避免在某些 broken React 类型环境下 members 退化为 never[]。
    const memberList: MemberStatus[] = members;
    const member = disableMemberPreview ? undefined : memberList.find((m) => m.user_id === citation.user_id);
    const memberContent = member?.content?.trim();

    const isVisible = activeKey === badgeKey;

    return (
        <Popover
            trigger="custom"
            visible={isVisible}
            position="top"
            showArrow
            onClickOutSide={() => closeKey(badgeKey)}
            content={
                <div style={{ maxWidth: 360, padding: '8px 4px', maxHeight: 400, overflowY: 'auto' }}>
                    <div style={memberRowStyle}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: memberContent ? 4 : 0 }}>
                            {t("summary.citation.member", { values: { name: citation.user_name } })}
                        </div>
                        {!disableMemberPreview && memberContent ? (
                            <CitationText
                                content={(memberContent || '').replace(/\[\d+\]/g, '')}
                                citations={[]}
                                hidePlainCitations
                            />
                        ) : !disableMemberPreview && member?.status === "declined" ? (
                            // OCT-15 / upstream #495：纵深防御。正常流程里 declined 成员不会被
                            // 后端写进 team_citations（GLM 评审结论），但若数据漂移让 popover
                            // 拿到一个 declined 的 [Pn]，不再误显示「等待提交」。
                            // 复用已有 i18n key summary.confirmPage.declined（“已拒绝参与” /
                            // “Participation declined”），不新增翻译。
                            <div style={{ fontSize: 12, color: '#999' }}>
                                {t("summary.confirmPage.declined")}
                            </div>
                        ) : !disableMemberPreview ? (
                            <div style={{ fontSize: 12, color: '#999' }}>
                                {t("summary.detail.waitingSubmit", { values: { name: citation.user_name } })}
                            </div>
                        ) : null}
                    </div>
                </div>
            }
        >
            <sup className="citation-badge" style={badgeStyle} onClick={() => onBadgeClick(badgeKey)}>[P{index}]</sup>
        </Popover>
    );
};

export default CitationBadge;
