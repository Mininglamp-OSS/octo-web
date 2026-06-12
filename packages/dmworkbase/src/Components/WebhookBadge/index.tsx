import React from "react";
import { useI18n } from "../../i18n";
import "./index.css";

interface WebhookBadgeProps {
    className?: string;
}

/**
 * 发送者名旁的标识（仿 AiBadge 形态的灰色小胶囊），标记消息来自群入站
 * Webhook（群消息推送）而非真实用户。
 *
 * 文案走本地化（zh「推送」/ en「Push」）：头像已走用户头像链路、名字取自
 * payload，webhook 消息与真人消息视觉上几乎无差别，这枚徽章是唯一区分信号。
 * 不用「机器人 / Bot」是为了和可交互的 AI 助手（紫色「AI」徽章）区分——
 * webhook 是单向消息推送、不可对话，「推送」既贴合功能名「群消息推送」又不撞 bot 概念。
 */
const WebhookBadge: React.FC<WebhookBadgeProps> = ({ className }) => {
    const { t } = useI18n();
    const combinedClassName = className
        ? `wk-webhook-badge ${className}`
        : "wk-webhook-badge";
    return <span className={combinedClassName}>{t("base.message.webhookBadge")}</span>;
};

export default WebhookBadge;
