import React from "react";
import MatterList from "../../ui/MatterList";

/**
 * ChatMatterPanel — 会话页面右侧的事项列表面板。
 *
 * 已统一到 ui/MatterList（mode="channel"）。本文件保留为薄封装，
 * 维持对外的 props 契约不变（module.tsx 的 registerChatMatterPanel 仍用它）。
 */

export interface ChatMatterPanelProps {
  channelId: string;
  channelType: number;
  channelName?: string;
  onClose: () => void;
}

export default function ChatMatterPanel({
  channelId,
  channelType,
  channelName,
  onClose,
}: ChatMatterPanelProps) {
  return (
    <MatterList
      mode="channel"
      channelId={channelId}
      channelType={channelType}
      channelName={channelName}
      onClose={onClose}
    />
  );
}

export { ChatMatterPanel };
