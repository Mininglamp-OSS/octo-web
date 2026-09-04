import { useCallback, useRef, useState } from "react";
import AppBotService from "../Service/AppBotService";
import type { AppBotViewItem } from "../bridge/types";
import { useAppBotHost } from "../host/AppBotHostContext";
import type {
  AppBotConversationTarget,
  AppBotHostCapabilities,
} from "../host/types";
import { showErrorToast } from "./appBotToast";

interface OpenAppBotConversationDeps {
  applyBot: (robotUid: string) => Promise<unknown>;
}

export function createAppBotConversationTarget(
  bot: AppBotViewItem
): AppBotConversationTarget {
  return {
    channelId: bot.uid,
    channelType: 1,
    displayName: bot.displayName,
    avatar: `users/${bot.uid}/avatar`,
    metadata: {
      displayName: bot.displayName,
      robot: 1,
      name: bot.displayName,
    },
  };
}

function trackAppOpened(host: AppBotHostCapabilities, bot: AppBotViewItem) {
  if (host.isOctoAssistant(bot.uid)) {
    host.track("octo_assistant_opened", {
      source: "app_bot_list",
    });
    return;
  }

  host.track("app_opened", {
    app_name: bot.displayName,
    app_category: bot.scope,
  });
}

const defaultDeps: OpenAppBotConversationDeps = {
  applyBot: (robotUid) => AppBotService.applyBot(robotUid),
};

export async function openAppBotConversation(
  bot: AppBotViewItem,
  host: AppBotHostCapabilities,
  deps: OpenAppBotConversationDeps = defaultDeps,
  callbacks: { onApplied?: () => void } = {}
) {
  await deps.applyBot(bot.uid);
  callbacks.onApplied?.();
  trackAppOpened(host, bot);
  await host.openConversation(createAppBotConversationTarget(bot));
}

interface UseAppBotConversationOptions {
  connectFailedMessage: string;
  onError?: (message: string) => void;
}

export function useAppBotConversation({
  connectFailedMessage,
  onError = showErrorToast,
}: UseAppBotConversationOptions) {
  const host = useAppBotHost();
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const isSelectingRef = useRef(false);

  const resetSelection = useCallback(() => {
    isSelectingRef.current = false;
    setSelectedUid(null);
    host.clearConversation();
  }, [host]);

  const selectBot = useCallback(
    async (bot: AppBotViewItem) => {
      if (isSelectingRef.current) return;
      isSelectingRef.current = true;
      try {
        await openAppBotConversation(bot, host, undefined, {
          onApplied: () => setSelectedUid(bot.uid),
        });
      } catch (err) {
        console.error("[AppBotPage] handleSelect failed:", err);
        onError(connectFailedMessage);
      } finally {
        isSelectingRef.current = false;
      }
    },
    [connectFailedMessage, host, onError]
  );

  return {
    selectedUid,
    selectBot,
    resetSelection,
  };
}
