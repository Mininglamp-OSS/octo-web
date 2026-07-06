import React, { useContext, useMemo } from 'react';
import { Popover } from '@douyinfe/semi-ui';
import { i18n, useI18n } from '@octo/base';
import { Channel, ChannelTypeGroup, ChannelTypePerson } from 'wukongimjssdk';
import WKApp from '@octo/base/src/App';
import { ShowConversationOptions } from '@octo/base/src/EndpointCommon';
import { ChannelTypeCommunityTopic } from '@octo/base/src/Service/Const';
import { CitationContext } from './CitationText';
import { CitationItem, CitationContextMessage } from '../types/summary';

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

export default CitationBadge;
