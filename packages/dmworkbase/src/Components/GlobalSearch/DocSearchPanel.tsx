import React, { useCallback, useMemo } from "react";
import { useI18n } from "../../i18n";
import type {
  DocSearchItem,
  GlobalSearchDataSource,
} from "../../Service/SearchTypes";
import useSearchPagination from "../../bridge/search/useSearchPagination";
import { Loading } from "@octo/ui";
import "./doc-search-panel.css";

const PAGE_SIZE = 20;

// Upper bound on the highlight fragment we scan/render. renderHighlight walks
// the string with a global regex and slices around each match; an unbounded
// fragment (a pathological OpenSearch highlight) would make that scan and the
// resulting node array grow with the input. The backend fragment is a short
// snippet in practice, so truncating past this bound only affects abuse cases.
const HIGHLIGHT_MAX_LEN = 2000;

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
function renderHighlight(rawFragment: string): React.ReactNode {
  // Bound the scan so a pathologically long fragment can't drive a large slice
  // loop / node array (defense-in-depth; real backend fragments are short).
  const fragment =
    rawFragment.length > HIGHLIGHT_MAX_LEN
      ? rawFragment.slice(0, HIGHLIGHT_MAX_LEN)
      : rawFragment;
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

  // Keyset (search_after) pagination via the shared cursor-paginator: the hook
  // passes the previous page's `nextCursor` back as `cursor` (undefined on the
  // first page), and we surface the backend's `nextCursor` for the next round.
  // hasMore is simply "the backend handed us a nextCursor" — no page/total
  // arithmetic, so index churn between pages can't skip or repeat a row.
  const searchPage = useCallback(
    async (cursor?: string) => {
      const res = await dataSource.searchDocs!({
        keyword: trimmed,
        cursor,
        pageSize: PAGE_SIZE,
      });
      return {
        items: res.items,
        hasMore: !!res.nextCursor,
        nextCursor: res.nextCursor,
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
          <Loading text={t("base.globalSearch.docs.loading")} />
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
            <Loading size="sm" text={t("base.globalSearch.docs.loading")} />
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
        {/* Manual continuation. Shown whenever there's a next page and we're not
            mid-load or in an error state — this single branch covers both the
            normal case and the auto-pagination-paused case (a run of fully
            empty pages), since loadNextPage(true) forces past the pause guard.
            Merged from two identical buttons that only differed on the
            autoPaginationPaused flag. */}
        {!loadingMore && !paginationError && response.hasMore && (
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
