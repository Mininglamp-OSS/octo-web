import React, { ReactNode } from "react";

export interface NavItemProps {
    icon: ReactNode;
    label: string;
    active?: boolean;
    badge?: number;
    onClick?: () => void;
    /** 埋点对象标识(蒙版事件委托读 data-object-id);传导航项的 routePath。 */
    trackObjectId?: string;
}

export default function NavItem({ icon, label, active, badge, onClick, trackObjectId }: NavItemProps) {
    const badgeLabel = badge && badge > 99 ? "99+" : badge;

    return (
        <button
            type="button"
            className={`wk-navrail__item${active ? " wk-navrail__item--active" : ""}`}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            data-track="nav_tab_switched"
            data-object-id={trackObjectId}
            onClick={onClick}
        >
            {icon}
            {!!badge && (
                <span className="wk-navrail__badge">{badgeLabel}</span>
            )}
        </button>
    );
}
