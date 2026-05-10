import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Channel, ChannelTypePerson } from 'wukongimjssdk';
import WKAvatar from '@octo/base/src/Components/WKAvatar';
import UserName from '../UserName';
import {
    getMessageByChannel,
    IMMessageResp,
} from '../../api/imMessageApi';
import './index.css';

/**
 * AnchorPopover — 原消息上下文弹框 (对齐原型 v19 ContextAnchorPopover)
 *
 * 用途: 时间线条目点 "查看原消息上下文" 后弹出, 显示 entry.source_msgs
 * 里每条消息的详情 (发送人 / 时间 / 内容)。
 *
 * 接口:
 *   - GET /v1/groups/{group_no}/messages/{message_id}       (channel_type=2)
 *   - GET /v1/groups/{group_no}/threads/{short_id}/messages/{message_id}
 *                                                            (channel_type=5)
 *
 * 错误场景: 后端任何不可见情况都返回 404 (消息删除/撤回/非群成员/群解散等)。
 * 前端不区分具体原因, 统一显示 "该消息不可查看或已被删除"。
 *
 * UI 要点 (参考 prototype 19-Matters-prototype.html#ContextAnchorPopover):
 *   - 居中遮罩 + 浮层卡片
 *   - Header: "{channelName} · 上下文" + 关闭按钮
 *   - Body: 消息列表, 每条 = 时间 + 头像 + 人名 + 内容
 *   - ESC 关闭
 */

export interface AnchorPopoverProps {
    /** 原消息所在 channel (群 id / 子区拼接 channel id) */
    channelId: string;
    /** channel type (2=群, 5=子区) */
    channelType: number;
    /** 要查询的消息 ID 列表 (对应 TimelineEntry.source_msgs) */
    messageIds: string[];
    /** 展示在头部的 channel 名称 */
    channelName: string;
    onClose: () => void;
}

interface LoadedMessage {
    id: string;
    ok: true;
    data: IMMessageResp;
}
interface FailedMessage {
    id: string;
    ok: false;
    reason: 'not_found' | 'error';
}
type FetchResult = LoadedMessage | FailedMessage;

export default function AnchorPopover({
    channelId,
    channelType,
    messageIds,
    channelName,
    onClose,
}: AnchorPopoverProps) {
    const [results, setResults] = useState<FetchResult[]>([]);
    const [loading, setLoading] = useState(true);
    const bodyRef = useRef<HTMLDivElement>(null);

    // ESC 关闭
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    // 并发拉所有消息。单条失败不影响整体, 用 ok 标记区分。
    // channelId/channelType/messageIds 变化时重拉; 用 join 做 key 稳定对比。
    const ids = messageIds.join('|');
    useEffect(() => {
        let aborted = false;
        if (!channelId || messageIds.length === 0) {
            setResults([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        Promise.all(
            messageIds.map(
                async (mid): Promise<FetchResult> => {
                    try {
                        const data = await getMessageByChannel({
                            channelId,
                            channelType,
                            messageId: mid,
                        });
                        return { id: mid, ok: true, data };
                    } catch (err: unknown) {
                        const status =
                            (err as { status?: number } | undefined)?.status ??
                            (
                                err as {
                                    response?: { status?: number };
                                } | undefined
                            )?.response?.status;
                        return {
                            id: mid,
                            ok: false,
                            reason: status === 404 ? 'not_found' : 'error',
                        };
                    }
                },
            ),
        ).then((rs) => {
            if (aborted) return;
            // 保留原顺序 (Promise.all 按入参顺序 resolve)
            setResults(rs);
            setLoading(false);
        });
        return () => {
            aborted = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channelId, channelType, ids]);

    const onMaskClick = useCallback(() => {
        onClose();
    }, [onClose]);

    const stop = (e: React.MouseEvent) => e.stopPropagation();

    return (
        <>
            <div className="wk-anchor-pop__mask" onClick={onMaskClick} />
            <div
                className="wk-anchor-pop"
                role="dialog"
                aria-modal="true"
                onClick={stop}
            >
                <div className="wk-anchor-pop__head">
                    <span className="wk-anchor-pop__channel">
                        #{channelName} · 上下文
                    </span>
                    <button
                        type="button"
                        className="wk-anchor-pop__close"
                        onClick={onClose}
                        aria-label="关闭"
                    >
                        ✕
                    </button>
                </div>

                <div className="wk-anchor-pop__body" ref={bodyRef}>
                    {loading && (
                        <div className="wk-anchor-pop__empty">
                            正在加载消息...
                        </div>
                    )}
                    {!loading && results.length === 0 && (
                        <div className="wk-anchor-pop__empty">
                            没有关联原消息
                        </div>
                    )}
                    {!loading &&
                        results.map((r) => (
                            <MessageRow key={r.id} result={r} />
                        ))}
                </div>
            </div>
        </>
    );
}

// ─── 单条消息行 ──────────────────────────────────────

function MessageRow({ result }: { result: FetchResult }) {
    if (!result.ok) {
        return (
            <div className="wk-anchor-pop__msg wk-anchor-pop__msg--missing">
                <span className="wk-anchor-pop__msg-time">—</span>
                <div className="wk-anchor-pop__msg-content">
                    <div className="wk-anchor-pop__msg-text wk-anchor-pop__msg-text--dim">
                        {result.reason === 'not_found'
                            ? '该消息不可查看或已被删除'
                            : '加载失败, 请稍后再试'}
                    </div>
                </div>
            </div>
        );
    }
    const msg = result.data;
    return (
        <div className="wk-anchor-pop__msg">
            <span className="wk-anchor-pop__msg-time">
                {formatTime(msg.timestamp)}
            </span>
            <span className="wk-anchor-pop__msg-avatar">
                <WKAvatar
                    channel={
                        new Channel(msg.from_uid, ChannelTypePerson)
                    }
                    style={{ width: 18, height: 18 }}
                />
            </span>
            <div className="wk-anchor-pop__msg-content">
                <div className="wk-anchor-pop__msg-name">
                    <UserName uid={msg.from_uid} />
                </div>
                <div className="wk-anchor-pop__msg-text">
                    {extractDisplayText(msg)}
                </div>
            </div>
        </div>
    );
}

/**
 * 从 payload 里提取可展示文本。payload 结构取决于消息类型 (type 字段):
 *   - 1/文本: { type:1, content:"..." }
 *   - 其它 (图片/文件/语音/系统消息...): 退化到一个类型标签 "[图片]" 等
 *
 * 这里只处理最常见的文本/AI富文本场景。其它类型后续可以补, 当前用类型描述
 * 占位, 足以让用户看到"确实是这条消息"。
 */
function extractDisplayText(msg: IMMessageResp): string {
    const p = msg.payload as Record<string, unknown> | undefined;
    if (!p) return '';
    // 文本消息
    const content = p.content;
    if (typeof content === 'string' && content.trim()) return content;
    // 类型降级: 展示一个占位, 方便用户识别
    const type = p.type;
    switch (type) {
        case 2:
            return '[图片]';
        case 3:
            return '[语音]';
        case 4:
            return '[视频]';
        case 5:
            return '[文件]';
        case 1000:
            return '[系统消息]';
        default:
            return typeof type === 'number'
                ? `[消息 type=${type}]`
                : '[消息]';
    }
}

function formatTime(ts: number): string {
    if (!ts) return '';
    // 后端 timestamp 是秒级 10 位, 乘 1000 转毫秒
    const d = new Date(ts * 1000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}
