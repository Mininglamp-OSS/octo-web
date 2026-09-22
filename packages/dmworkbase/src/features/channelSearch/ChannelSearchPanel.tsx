import React, { useCallback, useEffect, useRef, useState } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { Filter, X } from "lucide-react";
import { Channel } from "wukongimjssdk";
import IconClick from "../../Components/IconClick";
import ConversationContext from "../../Components/Conversation/context";
import { useI18n } from "../../i18n";
import SearchWorkspace from "../../ui/SearchWorkspace";
import useSearchPagination from "../../bridge/search/useSearchPagination";
import { channelSearchEmptyDataSource } from "../../Components/ChannelSearch/adapter";
import {
  CHANNEL_SEARCH_KEYWORD_MAX_RUNES,
  countChannelSearchKeywordRunes,
  shouldRunChannelSearch as shouldRunSearch,
  truncateChannelSearchKeyword,
} from "../../Service/SearchService";
import { activeChannelSearchFilterCount } from "../../bridge/channelSearch/filterState";
import { resolveChannelSearchLocateTarget } from "../../bridge/channelSearch/locate";
import { defaultChannelSearchFilters } from "../../Service/SearchTypes";
import type {
  ChannelSearchDataSource,
  ChannelSearchFilters,
  ChannelSearchItem,
  ChannelSearchPanelState,
  ChannelSearchTab,
} from "../../Service/SearchTypes";
import WKApp from "../../App";
import { Dap } from "../../Service/Dap";
import { stripSpacePrefix } from "../../Service/SpacePrefix";
import { hasEffectiveFilters } from "../../Service/SearchResultMapper";
import { ChannelSearchFilterPopover as FilterPopover } from "./ChannelSearchFilters";
import {
  ChannelSearchEmpty as SearchEmpty,
  FileResultItem,
  MediaResultGrid,
  MixedResultItem,
} from "./ChannelSearchResults";
import { useOutsideDismiss } from "./useOutsideDismiss";
import "./channel-search-panel.css";

interface ChannelSearchPanelProps {
  channel: Channel;
  conversationContext?: ConversationContext;
  onClose: () => void;
  dataSource?: ChannelSearchDataSource;
  onLocateMessage?: (item: ChannelSearchItem) => void;
  onPreviewFile?: (item: ChannelSearchItem) => void;
  onPreviewMedia?: (item: ChannelSearchItem) => void;
  initialState?: ChannelSearchPanelState;
  onStateChange?: (state: ChannelSearchPanelState) => void;
}

const tabs: ChannelSearchTab[] = ["all", "message", "media", "file"];

const tabI18nKey: Record<ChannelSearchTab, string> = {
  all: "base.channelSearch.tabs.all",
  message: "base.channelSearch.tabs.message",
  media: "base.channelSearch.tabs.media",
  file: "base.channelSearch.tabs.file",
};

const ChannelSearchPanel: React.FC<ChannelSearchPanelProps> = ({
  channel,
  conversationContext,
  onClose,
  dataSource = channelSearchEmptyDataSource,
  onLocateMessage,
  onPreviewFile,
  onPreviewMedia,
  initialState,
  onStateChange,
}) => {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState(() =>
    truncateChannelSearchKeyword(initialState?.keyword || "")
  );
  const [activeTab, setActiveTab] = useState<ChannelSearchTab>(
    initialState?.activeTab || "all"
  );
  const [filters, setFilters] = useState<ChannelSearchFilters>(
    () => initialState?.filters || defaultChannelSearchFilters()
  );
  const [filterOpen, setFilterOpen] = useState(!!initialState?.filterOpen);
  const [openFileMenuId, setOpenFileMenuId] = useState<string | null>(null);
  const keywordLimitToastShownRef = useRef(false);
  const isComposingRef = useRef(false);
  const [isComposing, setIsComposing] = useState(false);
  const filterWrapRef = useRef<HTMLDivElement>(null);

  const filterCount = activeChannelSearchFilterCount(filters);
  const keywordRuneCount = countChannelSearchKeywordRunes(keyword);
  const keywordAtLimit =
    !isComposing && keywordRuneCount >= CHANNEL_SEARCH_KEYWORD_MAX_RUNES;
  const canSearch = shouldRunSearch({ keyword, filters, tab: activeTab });
  const getSender = useCallback(
    (uid: string) => dataSource.getSender(uid),
    [dataSource]
  );
  const getFilterDismissContainers = useCallback(
    () => [filterWrapRef.current],
    []
  );
  const closeFilterPopover = useCallback(() => {
    setFilterOpen(false);
  }, []);
  const handleApplyFilters = useCallback(
    (next: ChannelSearchFilters) => {
      // channel_search_filtered(DAP-218 A 类):在筛选面板「确定」应用处发,仅当筛选实际生效
      //   (与本文件 channel_search_query 的 hasEffectiveFilters 门控同口径,避免空应用刷量)。
      //   属性为静态枚举/布尔:has_sender / sort / time_range,绝不上报发送人 uid 明细或关键词。
      if (hasEffectiveFilters(next)) {
        const timeRange = next.datePreset ?? ((next.startAt || next.endAt) ? "custom" : "all");
        Dap.shared.track("channel_search_filtered", {
          channel_id: stripSpacePrefix(channel.channelID),
          has_sender: next.senderUids.length > 0,
          sort: next.sort,
          time_range: timeRange,
        });
      }
      setFilters(next);
    },
    [channel.channelID]
  );
  const updateKeyword = useCallback(
    (value: string) => {
      const runeCount = countChannelSearchKeywordRunes(value);
      const exceedsLimit = runeCount > CHANNEL_SEARCH_KEYWORD_MAX_RUNES;

      if (exceedsLimit && !keywordLimitToastShownRef.current) {
        Toast.warning(
          t("base.channelSearch.keywordLimitToast", {
            values: { count: CHANNEL_SEARCH_KEYWORD_MAX_RUNES },
          })
        );
        keywordLimitToastShownRef.current = true;
      }
      if (!exceedsLimit && runeCount < CHANNEL_SEARCH_KEYWORD_MAX_RUNES) {
        keywordLimitToastShownRef.current = false;
      }

      setKeyword(truncateChannelSearchKeyword(value));
    },
    [t]
  );
  const shouldKeepSemiPopupOpen = useCallback((target: Node) => {
    return (
      target instanceof Element &&
      !!target.closest(".semi-datepicker, .semi-popover, .semi-portal")
    );
  }, []);

  useOutsideDismiss(
    filterOpen,
    getFilterDismissContainers,
    closeFilterPopover,
    shouldKeepSemiPopupOpen
  );

  useEffect(() => {
    onStateChange?.({
      activeTab,
      filterOpen,
      filters,
      keyword,
    });
  }, [activeTab, filterOpen, filters, keyword, onStateChange]);

  const searchPage = useCallback(
    (cursor?: string) =>
      dataSource.searchMessages({
        channelId: channel.channelID,
        channelType: channel.channelType,
        keyword,
        tab: activeTab,
        filters,
        cursor,
        limit: 20,
      }),
    [activeTab, channel.channelID, channel.channelType, dataSource, filters, keyword]
  );
  const {
    autoPaginationPaused,
    contentRef,
    error,
    handleScroll: handleContentScroll,
    loadNextPage,
    loading,
    loadingMore,
    paginationError,
    queryStarted,
    response,
  } = useSearchPagination({
    enabled: canSearch && !isComposing,
    search: searchPage,
    errorMessage: t("base.channelSearch.searchFailed"),
    // channel_search_query 挪到「结果返回后」(onQueryComplete)才发,以带上 has_result(首页是否有命中)。
    // onQueryStart 早于结果、拿不到 has_result(owner 判定:时机问题,非后端下发)。
    // 同一 gate:空 keyword 且无有效 filter(如仅切媒体/文件 tab)不计,避免空检索刷量(#1452 P2-1)。
    // channel_id 归一 stripSpacePrefix → bare id:与本 PR 其余新命令式事件同一 channel_id 口径,
    // Space 部署下可跨事件 join。注意这不是「与后端 _search_ 对齐」——SearchService 发的是 raw
    // channel.channelID(见 SearchService.ts,不 strip);此处刻意归一到 bare 供数仓 join(#1452 R10 P2-2)。
    onQueryComplete: useCallback(
      (hasResult: boolean) => {
        if (keyword.trim().length === 0 && !hasEffectiveFilters(filters)) return;
        Dap.shared.track("channel_search_query", {
          channel_id: stripSpacePrefix(channel.channelID),
          tab: activeTab,
          has_result: hasResult,
        });
      },
      [channel.channelID, activeTab, keyword, filters]
    ),
  });

  const handleLocate = useCallback(
    (item: ChannelSearchItem) => {
      const locateTarget = resolveChannelSearchLocateTarget(item, channel);
      if (!locateTarget) {
        // 无法解析跳转目标(结果陈旧/畸形):点击什么都不发生,不计入点击(避免过计)。
        return;
      }
      // 埋点:结果可跳转才算一次有效点击(移到 guard 之后,见 #1452 review P2)。
      // result_type=命中项类别(message/file/media,由 item.kind 归一)、channel_id=当前会话(bare id)。
      Dap.shared.track("channel_search_result_clicked", {
        channel_id: stripSpacePrefix(channel.channelID),
        result_type:
          item.kind === "file"
            ? "file"
            : item.kind === "image" || item.kind === "video"
              ? "media"
              : "message",
      });
      if (onLocateMessage) {
        onLocateMessage(item);
        return;
      }
      if (!locateTarget.isCurrentChannel || !conversationContext) {
        WKApp.endpoints.showConversation(locateTarget.channel, {
          initLocateMessageSeq: locateTarget.messageSeq,
        });
        return;
      }
      conversationContext.locateMessage(locateTarget.messageSeq);
    },
    [channel, conversationContext, onLocateMessage]
  );

  const toggleFilterOpen = () => {
    setOpenFileMenuId(null);
    // channel_search_filter_panel_opened:仅在「打开」这一支计数。原 TrackRules 的
    // channel-search-filter-trigger 点击规则在开和关都触发(toggle)→ 翻倍(见 review P2-7)。已移除该规则。
    if (!filterOpen) {
      Dap.shared.track("channel_search_filter_panel_opened", {
        channel_id: stripSpacePrefix(channel.channelID),
      });
    }
    setFilterOpen((open) => !open);
  };
  const handleFileMenuOpenChange = useCallback(
    (itemId: string, open: boolean) => {
      if (open) {
        setFilterOpen(false);
      }
      setOpenFileMenuId(open ? itemId : null);
    },
    []
  );

  const renderResults = () => {
    if (loading) {
      return (
        <div className="wk-channel-search-loading">
          {t("base.channelSearch.loading")}
        </div>
      );
    }
    if (error && response.items.length === 0) {
      return <div className="wk-channel-search-error">{error}</div>;
    }
    if (!queryStarted || response.items.length === 0) {
      return <SearchEmpty queryStarted={queryStarted} />;
    }
    if (activeTab === "media") {
      return (
        <MediaResultGrid
          items={response.items}
          onLocate={handleLocate}
          onPreviewMedia={onPreviewMedia}
        />
      );
    }
    if (activeTab === "file") {
      return (
        <div className="wk-channel-search-file-list">
          {response.items.map((item) => (
            <FileResultItem
              key={item.id}
              item={item}
              keyword={keyword}
              getSender={getSender}
              menuOpen={openFileMenuId === item.id}
              onMenuOpenChange={handleFileMenuOpenChange}
              onLocate={handleLocate}
              onPreviewFile={onPreviewFile}
            />
          ))}
        </div>
      );
    }
    return (
      <div className="wk-channel-search-result-list">
        {response.items.map((item) => (
          <MixedResultItem
            key={item.id}
            item={item}
            keyword={keyword}
            getSender={getSender}
            onLocate={handleLocate}
            onPreviewMedia={onPreviewMedia}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="wk-channel-search-panel">
      <SearchWorkspace
        search={{
          value: keyword,
          placeholder: t("base.channelSearch.placeholder"),
          autoFocus: true,
          onCompositionStart: () => {
            isComposingRef.current = true;
            setIsComposing(true);
          },
          onCompositionEnd: (event) => {
            isComposingRef.current = false;
            setIsComposing(false);
            updateKeyword(event.currentTarget.value);
          },
          onChange: (nextKeyword) => {
            if (isComposingRef.current) {
              setKeyword(nextKeyword);
              return;
            }
            updateKeyword(nextKeyword);
          },
          trailing: (
            <>
              {keywordAtLimit && (
                <span
                  className="wk-channel-search-keyword-limit"
                  role="status"
                  aria-live="polite"
                >
                  {t("base.channelSearch.keywordLimitHint", {
                    values: { count: CHANNEL_SEARCH_KEYWORD_MAX_RUNES },
                  })}
                </span>
              )}
              <IconClick
                size="sm"
                icon={<X size={18} />}
                title={t("base.channelSearch.close")}
                onClick={onClose}
              />
            </>
          ),
        }}

        tabs={tabs.map((tab) => ({ key: tab, label: t(tabI18nKey[tab]) }))}
        activeTab={activeTab}
        onTabChange={(nextTab) => {
          const tab = tabs.find((candidate) => candidate === nextTab);
          if (tab && tab !== activeTab) {
            // channel_search_tab_switched:仅在 tab 真正切换时计一次。原挂在 POST
            // /messages/_search_media|_search_files 的 2xx 通道,每次搜索/去抖/翻页都重打 → 过计数(见二审 P1-4)。
            Dap.shared.track("channel_search_tab_switched", {
              tab,
              channel_id: stripSpacePrefix(channel.channelID),
            });
            setActiveTab(tab);
          }
        }}
        actions={
          <div className="wk-channel-search-filter-wrap" ref={filterWrapRef}>
            <button
              className="wk-channel-search-filter-trigger"
              type="button"
              title={t("base.channelSearch.filter.title")}
              aria-expanded={filterOpen}
              onClick={toggleFilterOpen}
            >
              <Filter size={16} />
              <span className="wk-channel-search-filter-label">
                {t("base.channelSearch.filter.title")}
              </span>
              {filterCount > 0 && (
                <span className="wk-channel-search-filter-count">
                  {filterCount}
                </span>
              )}
            </button>
            <FilterPopover
              open={filterOpen}
              filters={filters}
              dataSource={dataSource}
              onApply={handleApplyFilters}
              onClose={() => setFilterOpen(false)}
            />
          </div>
        }
      >

      <div
        className="wk-channel-search-content"
        ref={contentRef}
        onScroll={handleContentScroll}
      >
        {activeTab === "media" && (
          <div className="wk-channel-search-media-tip">
            {t("base.channelSearch.mediaKeywordTip")}
          </div>
        )}
        {renderResults()}
        {loadingMore && (
          <div className="wk-channel-search-load-more" role="status">
            {t("base.channelSearch.loading")}
          </div>
        )}
        {paginationError && response.items.length > 0 && (
          <div className="wk-channel-search-load-more wk-channel-search-load-more--error">
            <span>{paginationError}</span>
            <button type="button" onClick={() => loadNextPage(true)}>
              {t("base.channelSearch.loadMore")}
            </button>
          </div>
        )}
        {autoPaginationPaused &&
          !paginationError &&
          !loadingMore &&
          response.hasMore && (
            <div className="wk-channel-search-load-more">
              <button type="button" onClick={() => loadNextPage(true)}>
                {t("base.channelSearch.loadMore")}
              </button>
            </div>
          )}
      </div>
      </SearchWorkspace>
    </div>
  );
};

export default ChannelSearchPanel;
export {
  ChannelSearchPanel,
  MixedResultItem,
  FileResultItem,
  MediaResultGrid,
  SearchEmpty as ChannelSearchEmpty,
};
