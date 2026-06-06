import React, { useRef, useState, useCallback } from "react";
import { Tooltip } from "@douyinfe/semi-ui";

interface OverflowTooltipProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    as?: React.ElementType;
}

const OverflowTooltip: React.FC<OverflowTooltipProps> = ({ children, className, style, as: Component = "div" }) => {
    const containerRef = useRef<HTMLElement>(null);
    const [visible, setVisible] = useState(false);
    const [content, setContent] = useState("");

    // NOTE: we intentionally use trigger="custom" instead of trigger="hover".
    // With trigger="hover", semi binds its own mouseenter/focus handlers that mount
    // the overlay from internal state (empty content on first hover) and bypass the
    // controlled `visible` prop, producing an empty dark bubble. trigger="custom"
    // makes visibility depend solely on `visible`, so the overlay only ever mounts
    // when the title is truly overflowing and the text is non-empty.
    const handleMouseEnter = useCallback(() => {
        const el = containerRef.current;
        if (el && el.scrollWidth > el.clientWidth) {
            const text = el.textContent ?? "";
            if (text.trim()) {
                setContent(text);
                setVisible(true);
            }
        }
    }, []);

    const handleMouseLeave = useCallback(() => {
        setVisible(false);
    }, []);

    return (
        <Tooltip
            content={content}
            position="bottom"
            trigger="custom"
            visible={visible && content.length > 0}
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
