import React, { useCallback, useMemo, useRef, useEffect } from "react";
import { useI18n } from "../../i18n";
import type {
  DocSearchItem,
  GlobalSearchDataSource,
} from "../../Service/SearchTypes";
import useSearchPagination from "../../bridge/search/useSearchPagination";
import "./doc-search-panel.css";

const PAGE_SIZE = 20;

interface DocSearchPanelProps {
  keyword: string;
  dataSource: GlobalSearchDataSource;
  // Mounted alongside the other tab panels and toggled via display:none, so a
  // hidden panel must not run/paginate its search. Gate on isActive (same
  // reasoning as GlobalContentSearchPanel).
  isActive?: boolean;
  // Integration point: open the clicked cloud doc. Wired by the host (Chat) to
  // buildDocLink -> window.open in a new tab; the search modal is deliberately
  // kept open so several results can be opened in turn. No-op default keeps this
  // panel self-contained when the prop is unwired.
  onOpenDoc?: (item: DocSearchItem) => void;
}

// Backend `highlight` may contain <em></em>. Render it into React text nodes
// with an <em>-only allowlist: everything between/around the tags becomes a
// plain React string (auto-escaped by React), and only the marked spans are
// wrapped in <em>. This never uses dangerouslySetInnerHTML, so injected markup
// in the fragment cannot execute.
function renderHighlight(fragment: string): React.ReactNode {
  const pattern = /<em>([\s\S]*?)<\/em>/gi;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(fragment))) {
    if (match.index > cursor) {
      nodes.push(fragment.slice(cursor, match.index));
    }
    nodes.push(<em key={key++}>{match[1]}</em>);
    cursor = pattern.lastIndex;
  }
  if (cursor < fragment.length) nodes.push(fragment.slice(cursor));
  return nodes.length > 0 ? nodes : fragment;
}

const DOC_TYPE_BADGE: Record<string, string> = {
  doc: "DOC",
  sheet: "XLS",
  board: "BRD",
};

function formatUpdatedAt(ms: number, locale: string): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleDateString(locale);
  } catch {
    return "";
  }
}

const DocSearchPanel: React.FC<DocSearchPanelProps> = ({
  keyword,
  dataSource,
  isActive = true,
  onOpenDoc,
}) => {
  const { t, locale } = useI18n();
  const trimmed = keyword.trim();
  const canSearch = !!trimmed && isActive && !!dataSource.searchDocs;

  // Accumulated item count across pages for the current query, used only to
  // cap pagination once we've observed >= total. Reset on ANY change that
  // makes useSearchPagination clear its own response.items — i.e. when the
  // trimmed keyword changes AND when the enabled/canSearch state flips.
  // useSearchPagination's own effect (deps: [enabled, ...]) clears its
  // response every time enabled changes, so a tab switch (isActive false
  // then true again with the same keyword) leaves visible items = 0 but
  // would otherwise leave loadedRef at its stale accumulated value; the
  // next first-page fetch would then push loadedRef >= total and prematurely
  // hide load-more. Keying reset on both trimmed and canSearch mirrors the
  // hook's own reset lifecycle so the accumulator stays in sync.
  const loadedRef = useRef(0);
  useEffect(() => {
    loadedRef.current = 0;
  }, [trimmed, canSearch]);

  // Reuse the shared cursor-paginator by encoding the 1-based page as the
  // cursor string ("2", "3", ...). searchDocs is page-based; map both ways.
  const searchPage = useCallback(
    async (cursor?: string) => {
      const page = cursor ? Number(cursor) || 1 : 1;
      const res = await dataSource.searchDocs!({
        keyword: trimmed,
        page,
        pageSize: PAGE_SIZE,
      });
      loadedRef.current += res.items.length;
      // Full-page detection must use the backend's ORIGINAL page size, not
      // res.items.length: SearchService.searchDocs drops items missing a
      // usable docId, which would otherwise forge a short page and stop
      // pagination early. rawItemCount is that pre-filter count.
      const rawCount = res.rawItemCount ?? res.items.length;
      // Stop pagination when the backend gave us a genuinely short page
      // (real end of the corpus) OR when the accumulated count has already
      // reached the reported total. The two clauses are independent so a
      // stale increment on loadedRef alone can't silently truncate results:
      // a full page from the server still forces hasMore=true.
      const hasMore = rawCount >= PAGE_SIZE && loadedRef.current < res.total;
      return {
        items: res.items,
        hasMore,
        nextCursor: hasMore ? String(page + 1) : undefined,
      };
    },
    [dataSource, trimmed]
  );

  const {
    contentRef,
    error,
    handleScroll,
    loadNextPage,
    loading,
    loadingMore,
    paginationError,
    queryStarted,
    response,
  } = useSearchPagination<DocSearchItem>({
    enabled: canSearch,
    search: searchPage,
    errorMessage: t("base.globalSearch.docs.searchFailed"),
  });

  const items = response.items;

  const emptyState = useMemo(() => {
    if (loading) {
      return (
        <div className="wk-doc-search__hint">
          {t("base.globalSearch.docs.loading")}
        </div>
      );
    }
    if (error && items.length === 0) {
      return <div className="wk-doc-search__hint">{error}</div>;
    }
    return (
      <div className="wk-doc-search__empty">
        {!trimmed
          ? t("base.globalSearch.docs.emptyHint")
          : queryStarted
            ? t("base.globalSearch.docs.noResults")
            : t("base.globalSearch.docs.emptyHint")}
      </div>
    );
  }, [error, items.length, loading, queryStarted, t, trimmed]);

  return (
    <div className="wk-doc-search">
      <div
        className="wk-doc-search__list"
        ref={contentRef}
        onScroll={handleScroll}
      >
        {items.length === 0 ? (
          emptyState
        ) : (
          <>
            {items.map((item) => (
              <button
                type="button"
                key={item.docId}
                className="wk-doc-search__item"
                onClick={() => onOpenDoc?.(item)}
              >
                <span
                  className={`wk-doc-search__icon wk-doc-search__icon--${item.docType}`}
                >
                  {DOC_TYPE_BADGE[item.docType] ?? "DOC"}
                </span>
                <span className="wk-doc-search__meta">
                  <span className="wk-doc-search__title">
                    {item.title || item.docId}
                  </span>
                  {item.highlight && (
                    <span className="wk-doc-search__snippet">
                      {renderHighlight(item.highlight)}
                    </span>
                  )}
                  <span className="wk-doc-search__sub">
                    {formatUpdatedAt(item.updatedAt, locale)}
                  </span>
                </span>
              </button>
            ))}
            {loadingMore && (
              <div className="wk-doc-search__hint" role="status">
                {t("base.globalSearch.docs.loading")}
              </div>
            )}
            {paginationError && (
              <div className="wk-doc-search__loadmore">
                <span>{paginationError}</span>
                <button type="button" onClick={() => loadNextPage(true)}>
                  {t("base.globalSearch.docs.loadMore")}
                </button>
              </div>
            )}
            {!loadingMore && !paginationError && response.hasMore && (
              <div className="wk-doc-search__loadmore">
                <button type="button" onClick={() => loadNextPage(true)}>
                  {t("base.globalSearch.docs.loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default DocSearchPanel;
