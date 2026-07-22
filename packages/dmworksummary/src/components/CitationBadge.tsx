import React, { useContext, useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Popover } from '@douyinfe/semi-ui';
import { i18n, useI18n } from '@octo/base';
import { Channel, ChannelTypeGroup, ChannelTypePerson } from 'wukongimjssdk';
import WKApp from '@octo/base/src/App';
import { ShowConversationOptions } from '@octo/base/src/EndpointCommon';
import { ChannelTypeCommunityTopic } from '@octo/base/src/Service/Const';
import CitationText, { CitationContext } from './CitationText';
import { CitationItem, CitationContextMessage, TeamCitationItem, MemberStatus } from '../types/summary';
import { formatGroupLabel } from './citationFormat';
import './CitationBadge.css';

/** Hover-preview delay (ms) tuned to match Perplexity/Kimi: long enough that
 * casual mouse traversal does not fire, short enough to feel instant when the
 * reader stops to look. */
const HOVER_OPEN_DELAY_MS = 400;
const HOVER_CLOSE_DELAY_MS = 200;

interface CitationBadgeProps {
    index: number;
    /**
     * Display index rendered inside the [n] label. When omitted, falls back
     * to `index`. Callers pass a re-numbered value (starting at 1 in reading
     * order) so users don't see raw pool positions like [37]. The internal
     * `index` still keys into the citations array — see remarkCitation in
     * CitationText for the mapping construction.
     */
    displayIndex?: number;
    citations: CitationItem[];
    badgeKey: string;
}

interface CitationGroupBadgeProps {
    indices: number[];
    /** Display indices, one per original index (same length as `indices`). */
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
                <div key={i} className="citation-context-msg">
                    <div className="citation-msg-header">
                        <span className="citation-msg-sender--context">{msg.sender}</span>
                        <span className="citation-msg-time--context">{formatTime(msg.sent_at)}</span>
                    </div>
                    <div className="citation-msg-body--context">{msg.content}</div>
                </div>
            ))}
        </>
    );
}

function JumpLink({ citation, badgeKey, closeKey }: { citation: CitationItem; badgeKey: string; closeKey: (key: string) => void }) {
    const { t } = useI18n();
    if (!citation.channel_id || !citation.message_seq || citation.channel_type == null) return null;
    return (
        <div className="citation-jumplink">
            <span
                className="citation-jumplink-btn"
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
 *
 * Click pins the popover (survives mouseleave), click again unpins. Hover
 * shows a temporary preview that fades on mouseleave. Combines both modes into
 * a single `visible` boolean the caller passes to Semi Popover in `custom`
 * trigger mode.
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

    // When pinned externally, drop the hover state so it doesn't fight the pin.
    useEffect(() => {
        if (pinned && hovering) setHovering(false);
    }, [pinned, hovering]);

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

    if (!citation) {
        return <sup className="citation-badge">[{shownIndex}]</sup>;
    }

    // Hover preview: compact 3-line card, no jump button. Pinned view: full
    // context (context_before + main + context_after + jump link).
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
            <ContextMessages messages={citation.context_before} />
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
            <ContextMessages messages={citation.context_after} />
            <JumpLink citation={citation} badgeKey={badgeKey} closeKey={closeKey} />
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
    const { activeKey, onBadgeClick, closeKey } = useContext(CitationContext);

    // Label uses the display indices (post-renumbering) so what the user sees
    // matches the [n] tokens in the body. Original `indices` still key the
    // citation lookup below.
    const shownList = displayIndices && displayIndices.length === indices.length ? displayIndices : indices;
    const label = formatGroupLabel(shownList);

    const indicesKey = indices.join(',');
    const groupCitations = useMemo(
        () => indicesKey.split(',').map(Number).map(i => citations.find(c => c.index === i)).filter((c): c is CitationItem => !!c),
        [indicesKey, citations]
    );
    const mergedMessages = useMemo(() => mergeGroupMessages(groupCitations), [groupCitations]);

    const pinned = activeKey === badgeKey;
    const { visible, onMouseEnter, onMouseLeave } = useHoverPin(pinned);

    if (groupCitations.length === 0) {
        return <sup className="citation-badge">[{label}]</sup>;
    }

    const firstCitation = groupCitations[0];

    // Hover preview: show first up-to-3 cited messages (compact, no context),
    // no jump link. Pinned view: full merged timeline + jump link.
    const previewContent = !pinned ? (
        <div className="citation-mini-preview">
            {groupCitations.slice(0, 3).map((c, i) => (
                <div key={c.message_seq ?? i} className="citation-cited-msg">
                    <div className="citation-msg-header">
                        <span className="citation-msg-sender">{c.sender}</span>
                        <span className="citation-msg-time">{formatTime(c.sent_at)}</span>
                    </div>
                    <div className="citation-msg-body">{c.content}</div>
                </div>
            ))}
        </div>
    ) : (
        <div className="citation-popover citation-popover--wide">
            {mergedMessages.map((msg, i) => (
                <div key={msg.message_seq ?? i} className={msg.cited ? 'citation-cited-msg' : 'citation-context-msg'}>
                    <div className="citation-msg-header">
                        <span className={msg.cited ? 'citation-msg-sender' : 'citation-msg-sender--context'}>{msg.sender}</span>
                        <span className={msg.cited ? 'citation-msg-time' : 'citation-msg-time--context'}>{formatTime(msg.sent_at)}</span>
                    </div>
                    <div className={msg.cited ? 'citation-msg-body' : 'citation-msg-body--context'}>{msg.content}</div>
                </div>
            ))}
            <JumpLink citation={firstCitation} badgeKey={badgeKey} closeKey={closeKey} />
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
        return <sup className="citation-badge">[P{index}]</sup>;
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
                <div className="citation-popover citation-popover--wide">
                    <div className="citation-cited-msg">
                        <div className="citation-msg-sender" style={{ marginBottom: memberContent ? 4 : 0 }}>
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
                            // 复用已有 i18n key summary.confirmPage.declined（"已拒绝参与" /
                            // "Participation declined"），不新增翻译。
                            <div className="citation-msg-source">
                                {t("summary.confirmPage.declined")}
                            </div>
                        ) : !disableMemberPreview ? (
                            <div className="citation-msg-source">
                                {t("summary.detail.waitingSubmit", { values: { name: citation.user_name } })}
                            </div>
                        ) : null}
                    </div>
                </div>
            }
        >
            <sup className="citation-badge" onClick={() => onBadgeClick(badgeKey)}>[P{index}]</sup>
        </Popover>
    );
};

export default CitationBadge;
