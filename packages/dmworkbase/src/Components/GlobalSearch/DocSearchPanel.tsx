import React, { useCallback, useMemo } from "react";
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
  // Integration point: open the clicked cloud doc, then dismiss the search
  // modal. Wired by the host (route/endpoint TBD). No-op default keeps P0
  // self-contained without hardcoding an unverified route.
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
      const loaded = page * PAGE_SIZE;
      const hasMore = loaded < res.total;
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
