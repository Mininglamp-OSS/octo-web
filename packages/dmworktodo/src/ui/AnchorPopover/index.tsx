import React, { useEffect, useState, useRef, useCallback } from 'react';
import { t, useI18n } from '@octo/base';
import type { IMMessageResp } from '../../api/imMessageApi';
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
    /**
     * popover 锚定 viewport 坐标 (px), 由调用方根据触发按钮
     * boundingClientRect 计算, 已做边界收缩。
     *
     * 垂直方向二选一:
     *   - top: 弹框顶边距 viewport 顶部的距离 (向下展开时使用)
     *   - bottom: 弹框底边距 viewport 底部的距离 (向上展开时使用)
     *
     * 用 bottom 锚定能让"向上展开"的弹框底边贴住按钮顶边, 不依赖
     * 弹框实际高度。两个都不传时居中。
     */
    x?: number;
    top?: number;
    bottom?: number;
    onClose: () => void;
    /** 外部注入的消息获取函数（UI/数据分离）。 */
    fetchMessage: (params: { channelId: string; channelType: number; messageId: string }) => Promise<IMMessageResp>;
    /** Render an avatar for the given uid at the given pixel size */
    renderAvatar: (uid: string, size: number) => React.ReactNode;
    /** Render a user name inline for the given uid */
    renderUserName: (uid: string) => React.ReactNode;
    /** 可选: 跳转到原消息回调。传入第一条成功加载消息的 message_seq。 */
    onJumpToMessage?: (messageSeq: number) => void;
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
    x,
    top,
    bottom,
    onClose,
    fetchMessage,
    renderAvatar,
    renderUserName,
    onJumpToMessage,
}: AnchorPopoverProps) {
    const { t: translate } = useI18n();
    const [results, setResults] = useState<FetchResult[]>([]);
    const [loading, setLoading] = useState(true);
    const bodyRef = useRef<HTMLDivElement>(null);

    const displayChannelName =
        channelName || channelId.slice(0, 8);

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
                        const data = await fetchMessage({
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
    }, [channelId, channelType, ids, fetchMessage]);

    const onMaskClick = useCallback(() => {
        onClose();
    }, [onClose]);

    const stop = (e: React.MouseEvent) => e.stopPropagation();

    // 跳转到原消息：使用第一条成功加载的消息的 message_seq 定位
    const handleJumpToMessage = useCallback(() => {
        if (!onJumpToMessage) return;

        // 找到第一条成功加载的消息
        const firstSuccess = results.find((r) => r.ok);
        if (!firstSuccess || !firstSuccess.ok) return;

        const messageSeq = firstSuccess.data.message_seq;

        // 关闭弹框并调用外部跳转逻辑
        onClose();
        onJumpToMessage(messageSeq);
    }, [results, onClose, onJumpToMessage]);

    // 有 x + top/bottom 时锚定到指定 viewport 坐标, 无则走 CSS 居中。
    // 用 bottom 锚定时弹框底边贴按钮顶边, 不再依赖弹框预估高度。
    const anchored =
        typeof x === 'number' &&
        (typeof top === 'number' || typeof bottom === 'number');
    const popStyle: React.CSSProperties | undefined = anchored
        ? {
              left: x,
              right: 'auto',
              top: typeof top === 'number' ? top : 'auto',
              bottom: typeof bottom === 'number' ? bottom : 'auto',
              transform: 'none',
              // 限制 max-height 防止溢出 viewport
              maxHeight:
                  typeof top === 'number'
                      ? `calc(100vh - ${top + 16}px)`
                      : typeof bottom === 'number'
                          ? `calc(100vh - ${bottom + 16}px)`
                          : undefined,
          }
        : undefined;

    // 是否有成功加载的消息且支持跳转（用于判断是否显示跳转按钮）
    const hasValidMessage = !loading && results.some((r) => r.ok) && onJumpToMessage;

    return (
        <>
            <div className="wk-anchor-pop__mask" onClick={onMaskClick} />
            <div
                className={`wk-anchor-pop${anchored ? ' is-anchored' : ''}`}
                role="dialog"
                aria-modal="true"
                style={popStyle}
                onClick={stop}
            >
                <div className="wk-anchor-pop__head">
                    <span className="wk-anchor-pop__channel">
                        #{displayChannelName}
                    </span>
                    {!loading && results.length > 0 && results[0].ok && (
                        <span className="wk-anchor-pop__head-time">
                            {formatTime(results[0].data.timestamp)}
                        </span>
                    )}
                </div>

                <div className="wk-anchor-pop__body" ref={bodyRef}>
                    {loading && (
                        <div className="wk-anchor-pop__empty">
                            {translate("todo.anchor.loadingMessages")}
                        </div>
                    )}
                    {!loading && results.length === 0 && (
                        <div className="wk-anchor-pop__empty">
                            {translate("todo.anchor.noSourceMessages")}
                        </div>
                    )}
                    {!loading &&
                        results.map((r) => (
                            <MessageRow
                                key={r.id}
                                result={r}
                                renderAvatar={renderAvatar}
                                renderUserName={renderUserName}
                                onJump={r.ok && onJumpToMessage ? () => {
                                    onClose();
                                    onJumpToMessage(r.data.message_seq);
                                } : undefined}
                            />
                        ))}
                </div>
            </div>
        </>
    );
}

// ─── 单条消息行 ──────────────────────────────────────

function MessageRow({
    result,
    renderAvatar,
    renderUserName,
    onJump,
}: {
    result: FetchResult;
    renderAvatar: (uid: string, size: number) => React.ReactNode;
    renderUserName: (uid: string) => React.ReactNode;
    onJump?: () => void;
}) {
    const { t: translate } = useI18n();
    if (!result.ok) {
        return (
            <div className="wk-anchor-pop__msg wk-anchor-pop__msg--missing">
                <div className="wk-anchor-pop__msg-header">
                    <span className="wk-anchor-pop__msg-time">—</span>
                </div>
                <div className="wk-anchor-pop__msg-content">
                    <div className="wk-anchor-pop__msg-text wk-anchor-pop__msg-text--dim">
                        {result.reason === 'not_found'
                            ? translate('todo.anchor.messageUnavailable')
                            : translate('todo.anchor.loadFailed')}
                    </div>
                </div>
            </div>
        );
    }
    const msg = result.data;
    return (
        <div
            className={`wk-anchor-pop__msg${onJump ? ' wk-anchor-pop__msg--clickable' : ' wk-anchor-pop__msg--disabled'}`}
            onClick={onJump}
            onKeyDown={onJump ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onJump(); } } : undefined}
            role={onJump ? 'button' : undefined}
            tabIndex={onJump ? 0 : undefined}
        >
            <div className="wk-anchor-pop__msg-header">
                <span className="wk-anchor-pop__msg-user">
                    <span className="wk-anchor-pop__msg-avatar">
                        {renderAvatar(msg.from_uid, 20)}
                    </span>
                    <span className="wk-anchor-pop__msg-name">
                        {renderUserName(msg.from_uid)}
                    </span>
                </span>
                <span className="wk-anchor-pop__msg-time">
                    {formatTime(msg.timestamp)}
                </span>
                <span className="wk-anchor-pop__msg-colon">：</span>
            </div>
            <div className="wk-anchor-pop__msg-content">
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
    if (typeof content === 'string' && content.trim()) {
        // 限制文本长度，超过 200 字符时截断并添加省略号
        const MAX_LENGTH = 200;
        const text = content.trim();
        if (text.length > MAX_LENGTH) {
            return text.slice(0, MAX_LENGTH) + '...';
        }
        return text;
    }
    // 类型降级: 展示一个占位, 方便用户识别
    const type = p.type;
    switch (type) {
        case 2:
            return t('todo.messageType.image');
        case 3:
            return t('todo.messageType.voice');
        case 4:
            return t('todo.messageType.video');
        case 5:
            return t('todo.messageType.shortVideo');
        case 6:
            return t('todo.messageType.location');
        case 7:
            return t('todo.messageType.contactCard');
        case 8: {
            // 文件消息：显示文件名和大小
            const name = p.name;
            const size = p.size;
            const fileName = typeof name === 'string' && name ? name : t('todo.messageType.unknownFile');
            if (typeof size === 'number' && size > 0) {
                const formattedSize = formatFileSize(size);
                return t('todo.messageType.fileWithSize', { values: { name: fileName, size: formattedSize } });
            }
            return t('todo.messageType.file', { values: { name: fileName } });
        }
        case 11:
            return t('todo.messageType.mergeForward');
        case 12:
        case 13:
            return t('todo.messageType.emoji');
        case 1000:
            return t('todo.messageType.system');
        default:
            return typeof type === 'number'
                ? t('todo.messageType.typedMessage', { values: { type } })
                : t('todo.messageType.message');
    }
}

/** 格式化文件大小（字节转为人类可读格式） */
function formatFileSize(bytes: number): string {
    if (bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatTime(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${min}`;
}
