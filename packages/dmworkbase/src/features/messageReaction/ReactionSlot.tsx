import React, { useEffect, useState } from "react";

import WKApp from "../../App";
import { useI18n } from "../../i18n";
import { reactionPickerOverlay } from "../../ui/message/MessageReactionPicker/ReactionPickerOverlay";
import MessageReactionSummary, {
  type MessageReactionChip,
} from "../../ui/message/MessageReactionSummary";
import { aggregateReactions } from "../../ui/message/MessageReactionSummary/aggregate";
import type { MessageReactionUser } from "../../Service/MessageReactionService";
import {
  MESSAGE_REACTION_UPDATED_EVENT,
  type MessageReactionTarget,
} from "./controller";
import { messageReactionController } from "./runtime";

export interface ReactionSlotProps {
  message: MessageReactionTarget;
}

function nameSeparator(locale: string): string {
  return locale.startsWith("zh") ? "、" : ", ";
}

function formatUserSummary(
  users: MessageReactionUser[],
  locale: string,
  translate: (
    key: string,
    opts?: { values?: Record<string, unknown> }
  ) => string
): string {
  const names = users.map((user) => user.name);
  const shown = names.slice(0, 3).join(nameSeparator(locale));
  if (names.length <= 3) return shown;
  return translate("base.reaction.moreUsers", {
    values: { names: shown, count: names.length },
  });
}

export default function ReactionSlot({ message }: ReactionSlotProps) {
  const { t, locale } = useI18n();
  const [, forceTick] = useState(0);
  const messageId = message.messageID;

  useEffect(() => {
    const handleUpdated = (changedMessageId: string) => {
      if (changedMessageId === messageId)
        forceTick((value: number) => value + 1);
    };
    WKApp.mittBus.on(MESSAGE_REACTION_UPDATED_EVENT, handleUpdated);
    return () => {
      WKApp.mittBus.off(MESSAGE_REACTION_UPDATED_EVENT, handleUpdated);
    };
  }, [messageId]);

  const currentUid = WKApp.loginInfo.uid;
  const groups = aggregateReactions(message.octoReactions, currentUid);
  const chips: MessageReactionChip[] = groups.map((group) => {
    const token = group.emoji ?? group.reactionKey;
    const isCustom = WKApp.emojiService?.isCustomEmoji?.(token) ?? false;
    const url = isCustom ? WKApp.emojiService?.getImage?.(token) ?? "" : "";
    const icon: React.ReactNode = url ? (
      <img src={url} alt="" draggable={false} />
    ) : (
      token
    );
    return {
      key: `${group.reactionType}-${group.reactionKey}`,
      icon,
      text: formatUserSummary(group.users, locale, t),
      hasMine: group.hasMine,
      title: group.users.map((user) => user.name).join(nameSeparator(locale)),
      onClick: () => {
        void messageReactionController.toggle(message, group.reactionKey);
      },
      reactionType: group.reactionType,
      reactionKey: group.reactionKey,
    };
  });

  const openPicker = (x: number, y: number) => {
    reactionPickerOverlay.open({
      x,
      y,
      messageId,
      selectedKeys: messageReactionController.selectedKeys(message),
      onSelect: (emoji) => {
        void messageReactionController.toggle(message, emoji);
      },
    });
  };

  return (
    <MessageReactionSummary
      chips={chips}
      addLabel={t("base.module.contextMenus.react")}
      onAdd={(event) => openPicker(event.clientX, event.clientY)}
    />
  );
}
