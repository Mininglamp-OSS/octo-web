import React, { useMemo } from "react";
import { useI18n } from "@octo/base";
import { useAppBots } from "../bridge/useAppBots";
import type { AppBotViewItem } from "../bridge/types";
import AppBotAvatar from "../features/AppBotAvatar";
import { useAppBotConversation } from "../features/appBotConversation";
import { AppBotHostProvider } from "../host/AppBotHostContext";
import type { AppBotHostCapabilities } from "../host/types";
import AppBotListView, { type AppBotListSection } from "../ui/AppBotListView";
import "../AppBotPage.css";

export interface AppsWorkspaceProps {
  host: AppBotHostCapabilities;
}

function AppsWorkspaceContent() {
  const { t } = useI18n();
  const conversation = useAppBotConversation({
    connectFailedMessage: t("appbot.error.connectFailed"),
  });
  const appBots = useAppBots({
    onSpaceChanged: conversation.resetSelection,
  });

  const sections: AppBotListSection[] = useMemo(
    () => [
      {
        key: "platform",
        title: t("appbot.section.platform"),
        bots: appBots.sections.platformBots,
      },
      {
        key: "space",
        title: appBots.spaceName
          ? t("appbot.section.spaceWithName", {
              values: { name: appBots.spaceName },
            })
          : t("appbot.section.space"),
        bots: appBots.sections.spaceBots,
      },
    ],
    [
      appBots.sections.platformBots,
      appBots.sections.spaceBots,
      appBots.spaceName,
      t,
    ]
  );

  const renderAvatar = (bot: AppBotViewItem) => <AppBotAvatar uid={bot.uid} />;

  return (
    <div className="appbot-page">
      <AppBotListView
        title={t("appbot.page.title")}
        searchPlaceholder={t("appbot.page.searchPlaceholder")}
        keyword={appBots.keyword}
        state={appBots.state}
        sections={sections}
        selectedUid={conversation.selectedUid}
        loadingText={t("appbot.state.loading")}
        loadFailedText={t("appbot.state.loadFailed")}
        retryLabel={t("appbot.action.retry")}
        emptyText={t("appbot.state.empty")}
        noMatchesText={t("appbot.state.noMatches")}
        defaultDescription={t("appbot.list.defaultDescription")}
        onKeywordChange={appBots.setKeyword}
        onRetry={appBots.reload}
        onSelect={conversation.selectBot}
        renderAvatar={renderAvatar}
      />
    </div>
  );
}

export default function AppsWorkspace({ host }: AppsWorkspaceProps) {
  return (
    <AppBotHostProvider host={host}>
      <AppsWorkspaceContent />
    </AppBotHostProvider>
  );
}

export { AppsWorkspace };
