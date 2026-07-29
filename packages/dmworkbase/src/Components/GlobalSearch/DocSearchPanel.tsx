import React, { useCallback, useMemo } from "react";
import { useI18n } from "../../i18n";
import type {
  DocSearchItem,
  GlobalSearchDataSource,
} from "../../Service/SearchTypes";
import useSearchPagination from "../../bridge/search/useSearchPagination";
import "./doc-search-panel.css";

const PAGE_SIZE = 20;

// Stable identity extractor for the paginator's cross-page dedup. Must be
// module-level (not an inline arrow) so useSearchPagination's `runSearch`
// useCallback identity stays stable across renders — an inline function would
// change every render and re-fire the search effect.
const docDedupeKey = (item: DocSearchItem) => item.docId;

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
  html: "WEB",
};

function formatUpdatedAt(ms: number | null, locale: string): string {
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

  // Reuse the shared cursor-paginator by encoding the 1-based page as the
  // cursor string ("2", "3", ...). searchDocs is page-based; map both ways.
  //
  // The stop condition is derived purely from the CURRENT request's own page
  // number and the server total — no cross-render mutable counter. Earlier
  // rounds kept a `loadedRef` accumulator that was `+=`-mutated inside this
  // callback, but that ran before useSearchPagination applied its
  // `requestIdRef` stale-response guard, so a discarded (superseded) request
  // could still bump the shared counter and silently truncate a later valid
  // page. `page * PAGE_SIZE` is a pure function of this request alone: a stale
  // response can never poison a fresh query's pagination, and the hook already
  // accumulates visible items in `response.items` for us.
  const searchPage = useCallback(
    async (cursor?: string) => {
      const page = cursor ? Number(cursor) || 1 : 1;
      const res = await dataSource.searchDocs!({
        keyword: trimmed,
        page,
        pageSize: PAGE_SIZE,
      });
      // Full-page detection must use the backend's ORIGINAL page size, not
      // res.items.length: SearchService.searchDocs drops items missing a
      // usable docId, which would otherwise forge a short page and stop
      // pagination early. rawItemCount is that pre-filter count.
      const rawCount = res.rawItemCount ?? res.items.length;
      // Continue only when the server returned a full page AND the pages we've
      // requested so far haven't yet covered the reported total. Both clauses
      // depend solely on this request, so no stale response can corrupt them.
      const hasMore = rawCount >= PAGE_SIZE && page * PAGE_SIZE < res.total;
      return {
        items: res.items,
        hasMore,
        nextCursor: hasMore ? String(page + 1) : undefined,
      };
    },
    [dataSource, trimmed]
  );

  const {
    autoPaginationPaused,
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
    // Offset paging has no stable cursor: index churn can repeat a docId across
    // pages. Dedup by docId so a repeat can't collide React keys (contract #4).
    dedupeKey: docDedupeKey,
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
        {items.length === 0
          ? emptyState
          : items.map((item) => (
              <button
                type="button"
                key={item.docId}
                className="wk-doc-search__item"
                onClick={() => onOpenDoc?.(item)}
              >
                <span
                  className={`wk-doc-search__icon wk-doc-search__icon--${
                    DOC_TYPE_BADGE[item.docType] ? item.docType : "doc"
                  }`}
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
        {/* Continuation controls are siblings of the results/empty branch, not
            nested inside it — otherwise an empty accumulator (every fetched
            page dropped by the docId filter, so items.length === 0 while the
            server still reports hasMore) hides the only way to continue and
            dead-ends the query. Mirrors GlobalContentSearchPanel. */}
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
        {!loadingMore &&
          !paginationError &&
          !autoPaginationPaused &&
          response.hasMore && (
            <div className="wk-doc-search__loadmore">
              <button type="button" onClick={() => loadNextPage(true)}>
                {t("base.globalSearch.docs.loadMore")}
              </button>
            </div>
          )}
        {/* Auto-pagination paused on an empty page: force a retry so a run of
            fully-filtered pages can't strand the user with no continuation. */}
        {autoPaginationPaused &&
          !paginationError &&
          !loadingMore &&
          response.hasMore && (
            <div className="wk-doc-search__loadmore">
              <button type="button" onClick={() => loadNextPage(true)}>
                {t("base.globalSearch.docs.loadMore")}
              </button>
            </div>
          )}
      </div>
    </div>
  );
};

export default DocSearchPanel;
