import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FileResultItem,
  MixedResultItem,
  ChannelSearchEmpty,
} from "../ChannelSearch/index";
import type {
  ChannelSearchItem,
  ChannelSearchResponse,
} from "../ChannelSearch/types";
import {
  isNearChannelSearchScrollBottom,
  shouldPauseAutoPaginationForEmptyPage,
  shouldStopPaginationForCursor,
} from "../ChannelSearch/pagination";
import { canLocateChannelSearchItem } from "../ChannelSearch/locate";
import { useI18n } from "../../i18n";
import { shouldRunGlobalSearch } from "./apiAdapter";
import { hasGlobalSearchCriteria } from "./filterState";
import {
  type GlobalContentTab,
  type GlobalSearchDataSource,
  type GlobalSearchFilters,
} from "./types";
import "./global-content-search-panel.css";

const SEARCH_DEBOUNCE_MS = 300;
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
  const [response, setResponse] = useState<ChannelSearchResponse>({
    items: [],
    hasMore: false,
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queryStarted, setQueryStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [autoPaginationPaused, setAutoPaginationPaused] = useState(false);
  const [openFileMenuId, setOpenFileMenuId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const loadingMoreCursorRef = useRef<string | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const canSearch = shouldRunGlobalSearch(tab, keyword, filters) && isActive;
  const hasSearchCriteria = hasGlobalSearchCriteria(tab, keyword, filters);
  const getSender = useCallback(
    (uid: string) => dataSource.getSender(uid),
    [dataSource]
  );

  const runSearch = useCallback(
    async (cursor?: string) => {
      if (cursor && loadingMoreCursorRef.current === cursor) return;
      if (!isActive) return;
      if (!shouldRunGlobalSearch(tab, keyword, filters)) return;

      loadingMoreCursorRef.current = cursor || null;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setQueryStarted(true);
      if (cursor) {
        setPaginationError(null);
        setLoadingMore(true);
      } else {
        setError(null);
        setPaginationError(null);
        setAutoPaginationPaused(false);
        setLoading(true);
      }

      try {
        const next = await dataSource.searchMessages({
          tab,
          keyword,
          filters,
          cursor,
          limit: PAGE_SIZE,
        });
        if (requestIdRef.current !== requestId) return;
        const stopPagination = shouldStopPaginationForCursor({
          hasMore: next.hasMore,
          nextCursor: next.nextCursor,
          requestedCursor: cursor,
        });
        const pauseAutoPagination = shouldPauseAutoPaginationForEmptyPage({
          hasMore: next.hasMore,
          itemCount: next.items.length,
          nextCursor: next.nextCursor,
          requestedCursor: cursor,
        });
        setAutoPaginationPaused(pauseAutoPagination);
        setResponse((prev) => ({
          items: cursor ? [...prev.items, ...next.items] : next.items,
          nextCursor: stopPagination ? undefined : next.nextCursor,
          hasMore: stopPagination ? false : next.hasMore,
        }));
      } catch (_) {
        if (requestIdRef.current === requestId) {
          const message = t("base.channelSearch.searchFailed");
          if (cursor) setPaginationError(message);
          else setError(message);
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
          if (loadingMoreCursorRef.current === cursor) {
            loadingMoreCursorRef.current = null;
          }
        }
      }
    },
    [tab, keyword, filters, dataSource, t, isActive]
  );

  const loadNextPage = useCallback(
    (force = false) => {
      if (!isActive) return;
      if (loading || loadingMore || !response.hasMore || !response.nextCursor) {
        return;
      }
      if ((paginationError || autoPaginationPaused) && !force) return;
      void runSearch(response.nextCursor);
    },
    [
      autoPaginationPaused,
      isActive,
      loading,
      loadingMore,
      paginationError,
      response.hasMore,
      response.nextCursor,
      runSearch,
    ]
  );

  const maybeLoadNextPageFromScroll = useCallback(
    (content: HTMLElement) => {
      if (isNearChannelSearchScrollBottom(content)) loadNextPage();
    },
    [loadNextPage]
  );

  const handleContentScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const content = event.currentTarget;
      if (typeof window.requestAnimationFrame !== "function") {
        maybeLoadNextPageFromScroll(content);
        return;
      }
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        maybeLoadNextPageFromScroll(content);
      });
    },
    [maybeLoadNextPageFromScroll]
  );

  useEffect(() => {
    return () => {
      if (
        scrollFrameRef.current !== null &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  // Reset + debounce on any input change.
  useEffect(() => {
    requestIdRef.current += 1;
    loadingMoreCursorRef.current = null;
    setResponse({ items: [], hasMore: false });
    setLoadingMore(false);
    setError(null);
    setPaginationError(null);
    setAutoPaginationPaused(false);

    if (!canSearch) {
      setQueryStarted(false);
      setLoading(false);
      return;
    }

    setQueryStarted(true);
    setLoading(true);
    const timer = window.setTimeout(() => {
      void runSearch();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [canSearch, runSearch]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    maybeLoadNextPageFromScroll(content);
  }, [maybeLoadNextPageFromScroll, response.items.length]);

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
