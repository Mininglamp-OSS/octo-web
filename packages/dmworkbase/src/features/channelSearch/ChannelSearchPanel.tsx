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
  });

  const handleLocate = useCallback(
    (item: ChannelSearchItem) => {
      const locateTarget = resolveChannelSearchLocateTarget(item, channel);
      if (!locateTarget) {
        return;
      }
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
          if (tab) setActiveTab(tab);
        }}
        actions={
          <div className="wk-channel-search-filter-wrap" ref={filterWrapRef}>
            <button
              className="wk-channel-search-filter-trigger"
              type="button"
              onClick={toggleFilterOpen}
            >
              <Filter size={16} />
              {t("base.channelSearch.filter.title")}
              {filterCount > 0 && <span>{filterCount}</span>}
            </button>
            <FilterPopover
              open={filterOpen}
              filters={filters}
              dataSource={dataSource}
              onApply={setFilters}
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
