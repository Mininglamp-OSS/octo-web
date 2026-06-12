import React from "react";
import "./index.css";

interface WebhookBadgeProps {
    className?: string;
}

/**
 * 发送者名旁的 Webhook 标识（仿 AiBadge 形态的灰色小胶囊），
 * 标记消息来自群入站 Webhook 而非真实用户。
 * "Webhook" 为专有名词，与 AiBadge 的 "AI" 一样不做本地化。
 */
const WebhookBadge: React.FC<WebhookBadgeProps> = ({ className }) => {
    const combinedClassName = className
        ? `wk-webhook-badge ${className}`
        : "wk-webhook-badge";
    return <span className={combinedClassName}>Webhook</span>;
};

export default WebhookBadge;
