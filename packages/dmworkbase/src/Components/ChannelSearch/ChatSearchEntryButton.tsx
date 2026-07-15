import React from "react";
import { Search } from "lucide-react";
import { Channel } from "wukongimjssdk";
import WKApp from "../../App";
import { t } from "../../i18n";
import { isChannelSearchEnabled } from "./feature";

interface ChatSearchEntryButtonProps {
  channel: Channel;
}

export default function ChatSearchEntryButton({
  channel,
}: ChatSearchEntryButtonProps) {
  if (!isChannelSearchEnabled(channel)) return null;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        WKApp.mittBus.emit("wk:open-channel-search", {
          channelId: channel.channelID,
          channelType: channel.channelType,
        });
      }}
      style={{ cursor: "pointer", display: "flex", alignItems: "center" }}
      title={t("base.module.channelSettings.messageHistory")}
    >
      <Search size={20} fill="none" color="currentColor" />
    </div>
  );
}
