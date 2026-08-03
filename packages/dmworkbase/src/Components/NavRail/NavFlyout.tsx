import React from "react";
import { createPortal } from "react-dom";
import { computePosition, flip, offset, shift } from "@floating-ui/dom";

export type NavFlyoutSize = "sm" | "md" | "lg";

export interface NavFlyoutProps {
    open: boolean;
    triggerRef: React.RefObject<HTMLElement>;
    onOpenChange: (open: boolean) => void;
    size?: NavFlyoutSize;
    role?: React.AriaRole;
    ariaLabel?: string;
    ariaLabelledby?: string;
    className?: string;
    children: React.ReactNode;
}

const initialPosition: React.CSSProperties = {
    position: "fixed",
    left: 64,
    bottom: 32,
};

export default function NavFlyout({
    open,
    triggerRef,
    onOpenChange,
    size = "md",
    role,
    ariaLabel,
    ariaLabelledby,
    className,
    children,
}: NavFlyoutProps) {
    const flyoutRef = React.useRef<HTMLDivElement>(null);
    const [style, setStyle] = React.useState<React.CSSProperties>(initialPosition);
    const wasOpenRef = React.useRef(false);

    React.useLayoutEffect(() => {
        if (!open) return;
        let cancelled = false;
        const update = () => {
            const trigger = triggerRef.current;
            const flyout = flyoutRef.current;
            if (!trigger || !flyout) return;
            computePosition(trigger, flyout, {
                placement: "right-end",
                strategy: "fixed",
                middleware: [offset(8), flip(), shift({ padding: 8 })],
            }).then(({ x, y }) => {
                if (!cancelled) {
                    setStyle({ position: "fixed", left: x, top: y });
                }
            });
        };
        update();
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        return () => {
            cancelled = true;
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
        };
    }, [open, triggerRef]);

    React.useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onOpenChange(false);
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, onOpenChange]);

    React.useEffect(() => {
        if (wasOpenRef.current && !open) {
            triggerRef.current?.focus();
        }
        wasOpenRef.current = open;
    }, [open, triggerRef]);

    if (!open) return null;

    const flyoutClassName = [
        "wk-navrail__flyout",
        `wk-navrail__flyout--${size}`,
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return createPortal(
        <>
            <div className="wk-navrail__flyout-mask" onClick={() => onOpenChange(false)} />
            <div
                ref={flyoutRef}
                className={flyoutClassName}
                role={role}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledby}
                style={style}
                onClick={(event) => event.stopPropagation()}
            >
                {children}
            </div>
        </>,
        document.body,
    );
}

export interface NavFlyoutMenuItemProps {
    children: React.ReactNode;
    onSelect?: (event: React.MouseEvent<HTMLButtonElement>) => void;
    role?: React.AriaRole;
    ariaChecked?: boolean;
    active?: boolean;
    trailing?: React.ReactNode;
    className?: string;
}

export function NavFlyoutMenuItem({
    children,
    onSelect,
    role = "menuitem",
    ariaChecked,
    active = false,
    trailing,
    className,
}: NavFlyoutMenuItemProps) {
    const itemClassName = [
        "wk-navrail__flyout-item",
        active && "wk-navrail__flyout-item--active",
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <button
            type="button"
            className={itemClassName}
            role={role}
            aria-checked={ariaChecked}
            onClick={onSelect}
        >
            <span className="wk-navrail__flyout-item-label">{children}</span>
            {trailing && <span className="wk-navrail__flyout-item-trailing">{trailing}</span>}
        </button>
    );
}
