import React from "react";

/** 加入 Space — 登入门 icon */
export function IconJoinSpace() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
        </svg>
    );
}

/** 创建 Space — plus icon */
export function IconCreateSpace() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    );
}

/** Space 管理 — sliders icon */
export function IconSpaceManagement() {
    return (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
            <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
            <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
            <circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
        </svg>
    );
}

/** Figma: filled/arrow/chevron_right 16x16 */
export function IconChevronRight() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
