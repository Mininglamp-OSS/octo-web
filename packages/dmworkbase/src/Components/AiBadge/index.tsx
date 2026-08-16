import React from "react";
import "./index.css";

export interface AiBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    size?: "default" | "small";
}

const AiBadge: React.FC<AiBadgeProps> = ({ size = "default", className, children = "AI", ...props }) => {
    const sizeClass = size === "small" ? "ai-badge-small" : "ai-badge-default";
    const combinedClassName = className
        ? `ai-badge ${sizeClass} ${className}`
        : `ai-badge ${sizeClass}`;

    return <span className={combinedClassName} {...props}>{children}</span>;
};

export default AiBadge;
