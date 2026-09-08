import { useCallback, useEffect, useRef, useState } from "react";
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

interface OpenAppBotConversationCallbacks {
  onApplied?: () => void;
  /** Fail-safe guard checked before every post-await side effect. */
  isCurrent?: () => boolean;
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
  callbacks: OpenAppBotConversationCallbacks = {}
) {
  const spaceId = host.getCurrentSpace().id;
  let spaceChanged = false;
  const unsubscribe = host.subscribeSpaceChanged(() => {
    spaceChanged = true;
  });
  const isCurrent = () =>
    !spaceChanged &&
    host.getCurrentSpace().id === spaceId &&
    callbacks.isCurrent?.() !== false;

  try {
    await deps.applyBot(bot.uid);
    if (!isCurrent()) return;
    callbacks.onApplied?.();
    if (!isCurrent()) return;
    trackAppOpened(host, bot);
    if (!isCurrent()) return;
    await host.openConversation(createAppBotConversationTarget(bot));
  } finally {
    unsubscribe();
  }
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
  const generationRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      isSelectingRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const resetSelection = useCallback(() => {
    generationRef.current += 1;
    isSelectingRef.current = false;
    setSelectedUid(null);
    host.clearConversation();
  }, [host]);

  const selectBot = useCallback(
    async (bot: AppBotViewItem) => {
      if (isSelectingRef.current) return;
      isSelectingRef.current = true;
      const generation = generationRef.current;
      try {
        await openAppBotConversation(bot, host, undefined, {
          onApplied: () => setSelectedUid(bot.uid),
          isCurrent: () =>
            isMountedRef.current && generation === generationRef.current,
        });
      } catch (err) {
        if (!isMountedRef.current || generation !== generationRef.current) {
          return;
        }
        console.error("[AppBotPage] handleSelect failed:", err);
        onError(connectFailedMessage);
      } finally {
        if (generation === generationRef.current) {
          isSelectingRef.current = false;
        }
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
