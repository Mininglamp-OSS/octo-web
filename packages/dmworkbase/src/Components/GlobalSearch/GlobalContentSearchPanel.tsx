import React, { useCallback, useState } from "react";
import {
  FileResultItem,
  MixedResultItem,
  ChannelSearchEmpty,
} from "../ChannelSearch/index";
import type { ChannelSearchItem } from "../../Service/SearchTypes";
import { canLocateChannelSearchItem } from "../../bridge/channelSearch/locate";
import { useI18n } from "../../i18n";
import { shouldRunGlobalSearch } from "../../Service/SearchService";
import { hasGlobalSearchCriteria } from "../../bridge/globalSearch/filterState";
import {
  type GlobalContentTab,
  type GlobalSearchDataSource,
  type GlobalSearchFilters,
} from "../../Service/SearchTypes";
import useSearchPagination from "../../bridge/search/useSearchPagination";
import "./global-content-search-panel.css";

const PAGE_SIZE = 20;

interface GlobalContentSearchPanelProps {
  tab: GlobalContentTab;
  keyword: string;
  dataSource: GlobalSearchDataSource;
  onLocateMessage: (item: ChannelSearchItem) => void;
  filters: GlobalSearchFilters;
  // Content panels for messages/files are all mounted at once and toggled via
  // `display:none` (avoids remounting <img>/VisibilityTrigger on tab switch).
  // A hidden container reports scrollHeight/scrollTop/clientHeight = 0, which
  // `isNearChannelSearchScrollBottom` reads as "at the bottom" and triggers
  // pagination in the background — for the files tab this walks the entire
  // corpus even when the user is on the messages tab. Gate both the initial
  // debounced fetch and scroll-driven pagination on isActive.
  isActive?: boolean;
}

const GlobalContentSearchPanel: React.FC<GlobalContentSearchPanelProps> = ({
  tab,
  keyword,
  dataSource,
  onLocateMessage,
  filters,
  isActive = true,
}) => {
  const { t } = useI18n();
  const [openFileMenuId, setOpenFileMenuId] = useState<string | null>(null);

  const canSearch = shouldRunGlobalSearch(tab, keyword, filters) && isActive;
  const hasSearchCriteria = hasGlobalSearchCriteria(tab, keyword, filters);
  const getSender = useCallback(
    (uid: string) => dataSource.getSender(uid),
    [dataSource]
  );

  const searchPage = useCallback(
    (cursor?: string) =>
      dataSource.searchMessages({
        tab,
        keyword,
        filters,
        cursor,
        limit: PAGE_SIZE,
      }),
    [dataSource, filters, keyword, tab]
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
    enabled: canSearch,
    search: searchPage,
    errorMessage: t("base.channelSearch.searchFailed"),
  });

  const handleFileMenuOpenChange = useCallback(
    (itemId: string, open: boolean) => {
      setOpenFileMenuId(open ? itemId : null);
    },
    []
  );

  const noPreviewMedia = undefined;
  const noPreviewFile = undefined;

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
      return (
        <ChannelSearchEmpty
          queryStarted={queryStarted && hasSearchCriteria}
          emptyHint={t("base.globalSearch.files.emptyHint")}
          noResultsHint={t("base.globalSearch.files.noResults")}
        />
      );
    }
    if (tab === "files") {
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
              onLocate={onLocateMessage}
              onPreviewFile={noPreviewFile}
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
            onLocate={
              canLocateChannelSearchItem(item)
                ? onLocateMessage
                : () => undefined
            }
            onPreviewMedia={noPreviewMedia}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="wk-global-content-search">
      <div
        className="wk-channel-search-content"
        ref={contentRef}
        onScroll={handleContentScroll}
      >
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
    </div>
  );
};

export default GlobalContentSearchPanel;
