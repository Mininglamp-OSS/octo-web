import React, { ReactNode } from "react";

export interface NavItemProps {
    icon: ReactNode;
    label: string;
    /** 窄容器下渲染的短文案;省略则回退到 label。
     *  长英文文案(如 "AI Summary")在 56×54 的 NavRail 竖排下会被 ellipsis 截成
     *  "Sum...",需要 caller 提供 shortLabel(通常来自 i18n 的 `.titleShort` 变体)。
     *  tooltip / aria-label 始终使用完整 label,可访问性和无障碍不打折。见 WS-216。 */
    shortLabel?: string;
    active?: boolean;
    badge?: number;
    onClick?: () => void;
    /** 埋点对象标识(蒙版事件委托读 data-object-id);传导航项的 routePath。 */
    trackObjectId?: string;
}

export default function NavItem({ icon, label, shortLabel, active, badge, onClick, trackObjectId }: NavItemProps) {
    const badgeLabel = badge && badge > 99 ? "99+" : badge;
    const displayLabel = shortLabel && shortLabel.length > 0 ? shortLabel : label;

    return (
        <button
            type="button"
            className={`wk-navrail__item${active ? " wk-navrail__item--active" : ""}`}
            aria-label={label}
            title={label}
            aria-current={active ? "page" : undefined}
            data-track="nav_tab_switched"
            data-object-id={trackObjectId}
            onClick={onClick}
        >
            {icon}
            <span className="wk-navrail__item-label">{displayLabel}</span>
            {!!badge && (
                <span className="wk-navrail__badge">{badgeLabel}</span>
            )}
        </button>
    );
}
