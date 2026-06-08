import React, { useRef, useState, useCallback } from "react";
import { Tooltip } from "@douyinfe/semi-ui";

interface OverflowTooltipProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    as?: React.ElementType;
    title?: string;
}

const OverflowTooltip: React.FC<OverflowTooltipProps> = ({ children, className, style, as: Component = "div", title }) => {
    const containerRef = useRef<HTMLElement>(null);
    const [visible, setVisible] = useState(false);

    // NOTE: we intentionally use trigger="custom" instead of trigger="hover".
    // With trigger="hover", semi binds its own mouseenter/focus handlers that mount
    // the overlay from internal state and bypass the controlled `visible` prop. The
    // content is now a stable, caller-supplied `title` string (not deferred state),
    // so the overlay never mounts with empty content and never produces a stray empty
    // dark bubble. Visibility depends solely on `visible`, which we flip on only when
    // the title is actually overflowing.
    const handleMouseEnter = useCallback(() => {
        const el = containerRef.current;
        if (el && el.scrollWidth > el.clientWidth) {
            setVisible(true);
        }
    }, []);

    const handleMouseLeave = useCallback(() => {
        setVisible(false);
    }, []);

    return (
        <Tooltip
            content={title ?? ""}
            position="bottom"
            trigger="custom"
            visible={visible}
        >
            <Component
                ref={containerRef}
                className={className}
                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...style }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {children}
            </Component>
        </Tooltip>
    );
};

export default OverflowTooltip;
