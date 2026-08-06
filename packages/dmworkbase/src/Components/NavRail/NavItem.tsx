import React, { ReactNode } from "react";

export interface NavItemProps {
    icon: ReactNode;
    label: string;
    active?: boolean;
    badge?: number;
    onClick?: () => void;
}

export default function NavItem({ icon, label, active, badge, onClick }: NavItemProps) {
    const badgeLabel = badge && badge > 99 ? "99+" : badge;

    return (
        <button
            type="button"
            className={`wk-navrail__item${active ? " wk-navrail__item--active" : ""}`}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            onClick={onClick}
        >
            {icon}
            <span className="wk-navrail__item-label">{label}</span>
            {!!badge && (
                <span className="wk-navrail__badge">{badgeLabel}</span>
            )}
        </button>
    );
}
