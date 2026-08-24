import React, { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "@octo/ui";

interface OverflowTooltipProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    as?: React.ElementType;
    title?: string;
    "data-testid"?: string;
}

const OverflowTooltip: React.FC<OverflowTooltipProps> = ({ children, className, style, as: Component = "div", title, "data-testid": dataTestId }) => {
    const containerRef = useRef<HTMLElement>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const [isTruncated, setIsTruncated] = useState(false);

    const checkTruncation = useCallback(() => {
        const el = containerRef.current;
        setIsTruncated(Boolean(el && el.scrollWidth > el.clientWidth));
    }, []);

    const setContainerRef = useCallback((node: HTMLElement | null) => {
        resizeObserverRef.current?.disconnect();
        resizeObserverRef.current = null;
        containerRef.current = node;
        if (!node) return;

        if (typeof ResizeObserver !== "undefined") {
            resizeObserverRef.current = new ResizeObserver(checkTruncation);
            resizeObserverRef.current.observe(node);
        }
    }, [checkTruncation]);

    useEffect(() => {
        checkTruncation();
    }, [children, title, checkTruncation]);

    useEffect(() => {
        window.addEventListener("resize", checkTruncation);
        return () => {
            resizeObserverRef.current?.disconnect();
            window.removeEventListener("resize", checkTruncation);
        };
    }, [checkTruncation]);

    const content = (
        <Component
            ref={setContainerRef}
            className={className}
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...style }}
            data-testid={dataTestId}
        >
            {children}
        </Component>
    );

    return isTruncated && title ? <Tooltip content={title} placement="bottom">{content}</Tooltip> : content;
};

export default OverflowTooltip;
