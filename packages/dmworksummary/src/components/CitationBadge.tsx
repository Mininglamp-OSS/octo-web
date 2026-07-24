import React, { useContext, useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Popover } from "@douyinfe/semi-ui";
import { i18n, useI18n } from "@octo/base";
import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
import WKApp from "@octo/base/src/App";
import WKAvatar from "@octo/base/src/Components/WKAvatar";
import { ShowConversationOptions } from "@octo/base/src/EndpointCommon";
import { ChannelTypeCommunityTopic } from "@octo/base/src/Service/Const";
import CitationText, { CitationContext } from './CitationText';
import { CitationItem, CitationContextMessage, TeamCitationItem, MemberStatus } from '../types/summary';
import { formatGroupLabel } from './citationFormat';
import './CitationBadge.css';

/** Hover-preview delay (ms) tuned to match Perplexity/Kimi */
const HOVER_OPEN_DELAY_MS = 400;
const HOVER_CLOSE_DELAY_MS = 200;

interface CitationBadgeProps {
    index: number;
    displayIndex?: number;
    citations: CitationItem[];
    badgeKey: string;
}

interface CitationGroupBadgeProps {
    indices: number[];
    displayIndices?: number[];
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
    background: 'rgba(127, 59, 245, 0.08)',
    color: '#7F3BF5',
    borderRadius: 99,
    padding: '2px 6px',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    marginLeft: 2,
    lineHeight: '18px',
    verticalAlign: 'baseline',
};

const contextMsgStyle: React.CSSProperties = {
    background: 'rgba(28, 28, 35, 0.04)',
    borderRadius: 8,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 14,
    lineHeight: '20px',
    color: '#1C1C23',
    wordBreak: 'break-word',
};

const citedMsgStyle: React.CSSProperties = {
    background: 'rgba(127, 59, 245, 0.04)',
    borderLeft: '2px solid #7F3BF5',
    borderRadius: '0 8px 8px 0',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 14,
    lineHeight: '20px',
    color: '#1C1C23',
    wordBreak: 'break-word',
};

interface MergedMessage {
    sender: string;
    sender_uid?: string;
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
                all.push({ sender: msg.sender, sender_uid: msg.sender_uid, content: msg.content, sent_at: msg.sent_at, message_seq: msg.message_seq, cited: false });
            }
        }
        all.push({
            sender: c.sender,
            sender_uid: c.sender_uid,
            content: c.content,
            sent_at: c.sent_at,
            message_seq: c.message_seq,
            cited: true,
            citation_index: c.index,
        });
        if (c.context_after) {
            for (const msg of c.context_after) {
                all.push({ sender: msg.sender, sender_uid: msg.sender_uid, content: msg.content, sent_at: msg.sent_at, message_seq: msg.message_seq, cited: false });
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

function MessageAvatar({ name, uid }: { name: string; uid?: string }) {
    if (uid) {
        return (
            <WKAvatar
                channel={new Channel(uid, ChannelTypePerson)}
                style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0 }}
            />
        );
    }
    const initials = name.slice(0, 1);
    return (
        <span style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#FF8800',
            color: '#FFFFFF',
            fontSize: 12,
            fontWeight: 600,
            lineHeight: '20px',
            textAlign: 'center',
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
        }}>
            {initials}
        </span>
    );
}

function MessageHeader({ sender, sentAt, uid, jumpLink }: { sender: string; sentAt: string; uid?: string; jumpLink?: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <MessageAvatar name={sender} uid={uid} />
                <span style={{ fontSize: 14, fontWeight: 500, lineHeight: '20px', color: '#1C1C23' }}>{sender}</span>
                <span style={{ fontSize: 14, fontWeight: 400, lineHeight: '20px', color: 'rgba(28, 28, 35, 0.4)', fontFamily: 'Inter, sans-serif', letterSpacing: '-0.01em' }}>{formatTime(sentAt)}</span>
                <span style={{ fontSize: 14, fontWeight: 400, lineHeight: '20px', color: '#1C1C23' }}>：</span>
            </div>
            {jumpLink}
        </div>
    );
}

function ContextMessages({ messages }: { messages?: CitationContextMessage[] }) {
    if (!messages?.length) return null;
    return (
        <>
            {messages.map((msg, i) => (
                <div key={i} style={{ ...contextMsgStyle, opacity: 0.5 }}>
                    <MessageHeader sender={msg.sender} sentAt={msg.sent_at} uid={msg.sender_uid} />
                    <div style={{ paddingLeft: 24, color: '#1C1C23', fontSize: 14, fontWeight: 400, lineHeight: '20px' }}>
                        {msg.content}
                    </div>
                </div>
            ))}
        </>
    );
}

function JumpLink({ citation, badgeKey, closeKey }: { citation: CitationItem; badgeKey: string; closeKey: (key: string) => void }) {
    const { t } = useI18n();
    if (!citation.channel_id || !citation.message_seq || citation.channel_type == null) return null;
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="rgba(28, 28, 35, 0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 400, lineHeight: '20px', color: 'rgba(28, 28, 35, 0.4)', cursor: 'pointer' }}
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

/**
 * Custom hook: delayed hover with an "always visible when pinned" override.
 * Click pins the popover (survives mouseleave), click again unpins. Hover
 * shows a temporary preview that fades on mouseleave.
 */
function useHoverPin(pinned: boolean) {
    const [hovering, setHovering] = useState(false);
    const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimers = useCallback(() => {
        if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
        if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    }, []);

    const onMouseEnter = useCallback(() => {
        if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
        if (hovering || pinned) return;
        openTimer.current = setTimeout(() => setHovering(true), HOVER_OPEN_DELAY_MS);
    }, [hovering, pinned]);

    const onMouseLeave = useCallback(() => {
        if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
        if (pinned) return;
        closeTimer.current = setTimeout(() => setHovering(false), HOVER_CLOSE_DELAY_MS);
    }, [pinned]);

    useEffect(() => () => clearTimers(), [clearTimers]);
    useEffect(() => { if (pinned && hovering) setHovering(false); }, [pinned, hovering]);

    const visible = pinned || hovering;
    return { visible, onMouseEnter, onMouseLeave };
}

const CitationBadge: React.FC<CitationBadgeProps> = ({ index, displayIndex, citations, badgeKey }) => {
    const { t } = useI18n();
    const { activeKey, onBadgeClick, closeKey } = useContext(CitationContext);
    const citation = citations.find(c => c.index === index);
    const shownIndex = displayIndex ?? index;

    const pinned = activeKey === badgeKey;
    const { visible, onMouseEnter, onMouseLeave } = useHoverPin(pinned);

    // Document-level Escape: works regardless of focus (e.g. after clicking jump link)
    useEffect(() => {
        if (!pinned) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); closeKey(badgeKey); }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [pinned, closeKey, badgeKey]);

    if (!citation) {
        return <sup className="citation-badge">[{shownIndex}]</sup>;
    }

    // Hover preview: compact card with sender + source + content snippet.
    // Pinned view: full context (context_before + main + context_after + jump link).
    const previewContent = !pinned ? (
        <div className="citation-mini-preview">
            <div className="citation-cited-msg">
                <div className="citation-msg-header">
                    <span className="citation-msg-sender">{citation.sender}</span>
                    <span className="citation-msg-time">{formatTime(citation.sent_at)}</span>
                </div>
                {citation.source && (
                    <div className="citation-msg-source">
                        {t("summary.citation.source", { values: { source: citation.source } })}
                    </div>
                )}
                <div className="citation-msg-body">{citation.content}</div>
            </div>
        </div>
    ) : (
        <div className="citation-popover">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 400, lineHeight: '18px', color: '#1C1C23', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {citation.source || t("summary.citation.sourceDefault")}
                </span>
                <span style={{ fontSize: 14, fontWeight: 400, lineHeight: '18px', color: 'rgba(28, 28, 35, 0.6)', flexShrink: 0 }}>
                    {formatTime(citation.sent_at)}
                </span>
            </div>
            <div style={{ height: 1, background: 'rgba(28, 28, 35, 0.15)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <ContextMessages messages={citation.context_before} />
                <div style={citedMsgStyle}>
                    <MessageHeader
                        sender={citation.sender}
                        sentAt={citation.sent_at}
                        uid={citation.sender_uid}
                        jumpLink={<JumpLink citation={citation} badgeKey={badgeKey} closeKey={closeKey} />}
                    />
                    <div style={{ paddingLeft: 24, fontSize: 14, fontWeight: 400, lineHeight: '20px', color: '#1C1C23' }}>
                        {citation.content}
                    </div>
                </div>
                <ContextMessages messages={citation.context_after} />
            </div>
        </div>
    );

    return (
        <Popover
            trigger="custom"
            visible={visible}
            position="top"
            showArrow
            onClickOutSide={() => closeKey(badgeKey)}
            content={previewContent}
        >
            <sup
                className="citation-badge"
                tabIndex={0}
                role="button"
                aria-expanded={visible}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
                onClick={() => onBadgeClick(badgeKey)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBadgeClick(badgeKey); }
                    if (e.key === 'Escape' && pinned) { e.preventDefault(); closeKey(badgeKey); }
                }}
            >[{shownIndex}]</sup>
        </Popover>
    );
};

export const CitationGroupBadge: React.FC<CitationGroupBadgeProps> = ({ indices, displayIndices, citations, badgeKey }) => {
    const { t } = useI18n();
    const { activeKey, onBadgeClick, closeKey } = useContext(CitationContext);

    const label = formatGroupLabel(displayIndices ?? indices);

    const indicesKey = indices.join(',');
    const groupCitations = useMemo(
        () => indicesKey.split(',').map(Number).map(i => citations.find(c => c.index === i)).filter((c): c is CitationItem => !!c),
        [indicesKey, citations]
    );
    const mergedMessages = useMemo(() => mergeGroupMessages(groupCitations), [groupCitations]);

    const pinned = activeKey === badgeKey;
    const { visible, onMouseEnter, onMouseLeave } = useHoverPin(pinned);

    // Document-level Escape: works regardless of focus (e.g. after clicking jump link)
    useEffect(() => {
        if (!pinned) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); closeKey(badgeKey); }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [pinned, closeKey, badgeKey]);

    if (groupCitations.length === 0) {
        return <sup className="citation-badge">[{label}]</sup>;
    }

    const firstCitation = groupCitations[0];

    // Hover preview: first up-to-3 cited messages compact. Pinned: full timeline + jump.
    const previewContent = !pinned ? (
        <div className="citation-mini-preview">
            {groupCitations.slice(0, 3).map((c, i) => (
                <div key={c.message_seq ?? i} className="citation-cited-msg">
                    <div className="citation-msg-header">
                        <span className="citation-msg-sender">{c.sender}</span>
                        <span className="citation-msg-time">{formatTime(c.sent_at)}</span>
                    </div>
                    {c.source && (
                        <div className="citation-msg-source">
                            {t("summary.citation.source", { values: { source: c.source } })}
                        </div>
                    )}
                    <div className="citation-msg-body">{c.content}</div>
                </div>
            ))}
        </div>
    ) : (
        <div className="citation-popover">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 400, lineHeight: '18px', color: '#1C1C23', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {firstCitation.source || t("summary.citation.sourceDefault")}
                </span>
            </div>
            <div style={{ height: 1, background: 'rgba(28, 28, 35, 0.15)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {mergedMessages.map((msg, i) => {
                    const cit = groupCitations.find(c => c.index === msg.citation_index);
                    return (
                        <div key={msg.message_seq ?? i} style={{ ...msg.cited ? citedMsgStyle : { ...contextMsgStyle, opacity: 0.5 } }}>
                            <MessageHeader
                                sender={msg.sender}
                                sentAt={msg.sent_at}
                                uid={msg.sender_uid}
                                jumpLink={msg.cited && cit ? <JumpLink citation={cit} badgeKey={badgeKey} closeKey={closeKey} /> : undefined}
                            />
                            <div style={{ paddingLeft: 24, fontSize: 14, fontWeight: 400, lineHeight: '20px', color: '#1C1C23' }}>
                                {msg.content}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return (
        <Popover
            trigger="custom"
            visible={visible}
            position="top"
            showArrow
            onClickOutSide={() => closeKey(badgeKey)}
            content={previewContent}
        >
            <sup
                className="citation-badge"
                tabIndex={0}
                role="button"
                aria-expanded={visible}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
                onClick={() => onBadgeClick(badgeKey)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBadgeClick(badgeKey); }
                    if (e.key === 'Escape' && pinned) { e.preventDefault(); closeKey(badgeKey); }
                }}
            >[{label}]</sup>
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
    background: 'rgba(127, 59, 245, 0.04)',
    borderLeft: '2px solid #7F3BF5',
    borderRadius: '0 8px 8px 0',
    padding: 8,
    fontSize: 14,
    lineHeight: '20px',
    color: '#1C1C23',
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
                <div style={{ width: 480, padding: 12, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 400, overflowY: 'auto' }}>
                    <div style={memberRowStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <MessageAvatar name={citation.user_name} uid={citation.user_id} />
                            <span style={{ fontWeight: 600, fontSize: 14, color: '#1C1C23', marginBottom: memberContent ? 4 : 0 }}>
                                {t("summary.citation.member", { values: { name: citation.user_name } })}
                            </span>
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
