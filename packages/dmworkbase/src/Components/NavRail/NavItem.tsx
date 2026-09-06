import React, { ReactNode } from "react";

export interface NavItemProps {
    icon: ReactNode;
    /** 完整文案。aria-label 始终用这个,保证 WCAG 2.5.3 Label in Name。 */
    label: string;
    /** 窄容器下渲染的短版本。提供时,组件同时渲染两个 span(full + short),
     *  由 CSS 按 `.wk-layout-tab-expanded` 祖先类挑一个显示,DOM 里两个都在,
     *  组件层不再做布局判断。见 #1635。 */
    shortLabel?: string;
    active?: boolean;
    badge?: number;
    onClick?: () => void;
    /** 埋点对象标识(蒙版事件委托读 data-object-id);传导航项的 routePath。 */
    trackObjectId?: string;
}

export default function NavItem({ icon, label, shortLabel, active, badge, onClick, trackObjectId }: NavItemProps) {
    const badgeLabel = badge && badge > 99 ? "99+" : badge;
    const hasDistinctShort = !!shortLabel && shortLabel !== label;

    return (
        <button
            type="button"
            className={`wk-navrail__item${active ? " wk-navrail__item--active" : ""}`}
            aria-label={label}
            // 只在 short≠full 时挂 native tooltip,避免 fully-visible 的
            // `Chats` / `Contacts` 冒冗余悬浮提示。tooltip 在 collapsed 和
            // expanded rail 都会出现:expanded 下文案已完整,tooltip 是冗余但
            // 无害;做真正 layout-aware 需要在 DOM 外拿到 `.wk-layout-tab-expanded`
            // 状态,超出本 PR 范围,后续可考虑用 accessible tooltip 组件替换
            // (native title 对键盘 / 触屏用户不可达,见 #1635 Not in scope)。
            title={hasDistinctShort ? label : undefined}
            aria-current={active ? "page" : undefined}
            data-track="nav_tab_switched"
            data-object-id={trackObjectId}
            onClick={onClick}
        >
            {icon}
            {hasDistinctShort ? (
                <>
                    <span className="wk-navrail__item-label wk-navrail__item-label--full">
                        {label}
                    </span>
                    <span className="wk-navrail__item-label wk-navrail__item-label--short">
                        {shortLabel}
                    </span>
                </>
            ) : (
                <span className="wk-navrail__item-label">{label}</span>
            )}
            {!!badge && (
                <span className="wk-navrail__badge">{badgeLabel}</span>
            )}
        </button>
    );
}
