import React from "react";
import { Search } from "lucide-react";
import { Channel } from "wukongimjssdk";
import WKApp from "../../App";
import { t } from "../../i18n";
import IconClick from "../../Components/IconClick";
import { isChannelSearchEnabled } from "./feature";

interface ChatSearchEntryButtonProps {
  channel: Channel;
}

export default function ChatSearchEntryButton({
  channel,
}: ChatSearchEntryButtonProps) {
  if (!isChannelSearchEnabled(channel)) return null;

  return (
    <IconClick
      size="sm"
      icon={<Search size={20} />}
      title={t("base.module.channelSettings.messageHistory")}
      onClick={() => {
        WKApp.mittBus.emit("wk:open-channel-search", {
          channelId: channel.channelID,
          channelType: channel.channelType,
        });
      }}
    />
  );
}
