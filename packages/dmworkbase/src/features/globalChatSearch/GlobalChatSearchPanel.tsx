import React, { useEffect, useMemo, useRef } from "react";
import { ChannelTypeCommunityTopic } from "../../Service/Const";
import {
  ChannelSearchEmpty,
  MixedResultItem,
} from "../../Components/ChannelSearch";
import { canLocateChannelSearchItem } from "../../bridge/channelSearch/locate";
import type {
  ChannelSearchItem,
  GlobalSearchDataSource,
  GlobalSearchFilters,
} from "../../Service/SearchTypes";
import useGlobalChatSearch from "../../bridge/globalChatSearch/useGlobalChatSearch";
import GlobalChatSearchLayout from "../../ui/GlobalChatSearchLayout";
import { useI18n } from "../../i18n";
import "./global-chat-search-panel.css";

interface GlobalChatSearchPanelProps {
  keyword: string;
  dataSource: GlobalSearchDataSource;
  onLocateMessage: (item: ChannelSearchItem) => void;
  isActive?: boolean;
  filters: GlobalSearchFilters;
}

export function GlobalChatSearchPanel({
  keyword,
  dataSource,
  onLocateMessage,
  isActive = true,
  filters,
}: GlobalChatSearchPanelProps) {
  const { t } = useI18n();
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const search = useGlobalChatSearch({
    keyword,
    filters,
    dataSource,
    isActive,
  });

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !search.result.hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void search.loadMore();
        }
      },
      { rootMargin: "160px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [search.loadMore, search.result.hasMore]);

  const conversations = useMemo(
    () =>
      search.overview.conversations.map((conversation) => ({
        key: conversation.key,
        name: conversation.name,
        subtitle: conversation.subtitle,
        avatarUrl: conversation.avatarUrl,
        countLabel: t("base.globalSearch.aggregated.messages", {
          values: { count: conversation.matchCount },
        }),
        isThread: conversation.channelType === ChannelTypeCommunityTopic,
      })),
    [search.overview.conversations, t]
  );

  const selected = search.selectedConversation;
  const resultCountLabel = selected
    ? t("base.globalSearch.aggregated.messages", {
        values: { count: selected.matchCount },
      })
    : undefined;

  const resultContent = (() => {
    if (!selected) {
      return (
        <ChannelSearchEmpty queryStarted={search.overview.status !== "idle"} />
      );
    }
    if (search.result.status === "error") {
      return (
        <div className="wk-global-chat-search-panel__state is-error">
          {t("base.globalSearch.searchFailedRetry")}
        </div>
      );
    }
    if (
      search.result.status === "loading" &&
      search.result.items.length === 0
    ) {
      return (
        <div className="wk-global-chat-search-panel__state">
          {t("base.channelSearch.loading")}
        </div>
      );
    }
    if (search.result.status === "ready" && search.result.items.length === 0) {
      return <ChannelSearchEmpty queryStarted />;
    }
    return (
      <div className="wk-global-chat-search-panel__results">
        {search.result.items.map((item) => (
          <MixedResultItem
            key={`${item.channelType}:${item.channelId}:${item.id}`}
            item={item}
            keyword={keyword}
            getSender={dataSource.getSender}
            onLocate={
              canLocateChannelSearchItem(item)
                ? onLocateMessage
                : () => undefined
            }
          />
        ))}
        {search.result.isLoadingMore && (
          <div className="wk-global-chat-search-panel__load-more">
            {t("base.channelSearch.loading")}
          </div>
        )}
        <div ref={loadMoreSentinelRef} />
      </div>
    );
  })();

  return (
    <GlobalChatSearchLayout
      conversations={conversations}
      selectedKey={search.selectedKey}
      labels={{
        filterTitle: t("base.globalSearch.aggregated.filterTitle"),
        startHint: t("base.globalSearch.aggregated.startHint"),
        emptyHint: t("base.globalSearch.aggregated.emptyHint"),
        errorHint: t("base.globalSearch.searchFailedRetry"),
        truncatedHint: t("base.globalSearch.aggregated.truncatedHint"),
      }}
      state={{
        status: search.overview.status,
        isTruncated: search.overview.isTruncated,
      }}
      result={{
        countLabel: resultCountLabel,
        content: resultContent,
      }}
      onSelectConversation={search.selectConversation}
    />
  );
}

export default GlobalChatSearchPanel;
