import React, { useEffect, useRef, useState } from "react";
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
    const [isTruncated, setIsTruncated] = useState(false);

    useEffect(() => {
        const checkTruncation = () => {
            const el = containerRef.current;
            setIsTruncated(Boolean(el && el.scrollWidth > el.clientWidth));
        };

        checkTruncation();
        const resizeObserver = typeof ResizeObserver === "undefined"
            ? undefined
            : new ResizeObserver(checkTruncation);
        if (containerRef.current) resizeObserver?.observe(containerRef.current);
        window.addEventListener("resize", checkTruncation);
        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener("resize", checkTruncation);
        };
    }, [children, title]);

    const content = (
        <Component
            ref={containerRef}
            className={className}
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...style }}
            data-testid={dataTestId}
        >
            {children}
        </Component>
    );

    return <Tooltip content={title} placement="bottom" isDisabled={!isTruncated || !title}>{content}</Tooltip>;
};

export default OverflowTooltip;
