import React from "react";
import AITag from "../../ui/AITag";
import "./index.css";

export interface AiBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    size?: "default" | "small";
}

const AiBadge: React.FC<AiBadgeProps> = ({ size = "default", className, children = "AI", ...props }) => {
    const sizeClass = size === "small" ? "ai-badge-small" : "ai-badge-default";
    const combinedClassName = className
        ? `ai-badge ${sizeClass} ${className}`
        : `ai-badge ${sizeClass}`;

    return <AITag size="xs" className={combinedClassName} {...props}>{children}</AITag>;
};

export default AiBadge;
