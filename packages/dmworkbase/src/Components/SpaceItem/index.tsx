import React, { ReactNode } from "react";
import SpaceAvatar, { SpaceAvatarSize } from "../SpaceAvatar";
import "./index.css";

function IconCheck() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

export interface SpaceItemProps {
    name: string;
    logo?: string;
    meta?: string;               // 副标签，如「12 成员」
    selected?: boolean;
    avatarSize?: SpaceAvatarSize;
    /** hover 时右侧出现的操作 slot */
    actions?: ReactNode;
    unreadCount?: number;
    unreadTone?: "new" | "total";
    unreadLabel?: string;
    onClick?: () => void;
    className?: string;
}

export default function SpaceItem({
    name,
    logo,
    meta,
    selected = false,
    avatarSize = "md",
    actions,
    unreadCount = 0,
    unreadTone = "total",
    unreadLabel,
    onClick,
    className,
}: SpaceItemProps) {
    const cls = [
        "wk-space-item",
        selected && "wk-space-item--selected",
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <div
            className={cls}
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick?.();
                }
            }}
        >
            <SpaceAvatar name={name} logo={logo} size={avatarSize} />
            <div className="wk-space-item__info">
                <span className="wk-space-item__name">{name}</span>
                {meta && <span className="wk-space-item__meta">{meta}</span>}
            </div>
            <div className="wk-space-item__trailing">
                {/* 复制按钮：opacity 0，hover 时 opacity 1，位置固定不跳 */}
                {actions && (
                    <div className="wk-space-item__actions">{actions}</div>
                )}
                {!selected && unreadCount > 0 && (
                    <span
                        className={`wk-space-item__unread wk-space-item__unread--${unreadTone}`}
                        role="img"
                        aria-label={unreadLabel}
                    >
                        {unreadCount > 99 ? "99+" : Math.floor(unreadCount)}
                    </span>
                )}
                {/* 对勾：selected 时固定显示 */}
                {selected && (
                    <span className="wk-space-item__check">
                        <IconCheck />
                    </span>
                )}
            </div>
        </div>
    );
}
