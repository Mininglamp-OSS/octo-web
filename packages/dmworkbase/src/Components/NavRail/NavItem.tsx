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
    const hasDistinctShort = !!shortLabel && shortLabel.length > 0 && shortLabel !== label;

    return (
        <button
            type="button"
            className={`wk-navrail__item${active ? " wk-navrail__item--active" : ""}`}
            aria-label={label}
            // 只在文案会被 CSS 截断的方向(collapsed rail 且短≠全)才挂 native tooltip,
            // 避免给 fully-visible 的 `Chats` / `Contacts` 加冗余悬浮提示。
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
