import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { File, FileText, FolderOpen } from "lucide-react";
import { useI18n } from "../../i18n";
import type {
  DriveFileType,
  DriveSearchHit,
  GlobalSearchDataSource,
} from "../../Service/SearchTypes";
import { formatFileSize } from "../../Utils/fileIcon";
import "./drive-search-panel.css";

const PAGE_SIZE = 20;
// Debounce keystrokes so a fast typist fires one search per pause, not one per
// character. Matches the drive module's own search box.
const DEBOUNCE_MS = 250;
// Trigger the next page while this many px from the bottom (same as the
// cursor-paged panels feed useSearchPagination).
const SCROLL_THRESHOLD_PX = 100;
// Upper bound on the highlight fragment we scan/render (see renderHighlight).
const HIGHLIGHT_MAX_LEN = 2000;
// Show at most this many body snippets per hit; the backend may return more.
const BODY_SNIPPET_MAX = 2;

// Abort rejections (keyword change / unmount cleanup calling controller.abort())
// are expected control flow, never a real search failure — filter them so a
// request we cancelled ourselves never flashes an error banner.
function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

interface DriveSearchPanelProps {
  keyword: string;
  dataSource: GlobalSearchDataSource;
  // Mounted alongside the other tab panels and toggled via display:none, so a
  // hidden panel must not run its search. Gate on isActive (same contract as
  // DocSearchPanel / GlobalContentSearchPanel).
  isActive?: boolean;
  // Integration point: open the clicked hit. Wired by the host (Chat) to
  // /drive?fileId=..&spaceId=.. -> window.open in a new tab; the search modal
  // is kept open so several results can be opened in turn. No-op default keeps
  // this panel self-contained when the prop is unwired.
  onOpenDriveHit?: (hit: DriveSearchHit) => void;
}

// Backend highlight fragments already wrap hits in <mark></mark>. Render them
// into React text nodes with a <mark>-only allowlist: everything between/around
// the tags becomes a plain React string (auto-escaped by React), and only the
// marked spans are wrapped in <mark>. This never uses dangerouslySetInnerHTML,
// so injected markup in the fragment cannot execute. (Same logic as
// DocSearchPanel.renderHighlight, with <em> swapped for <mark>.)
function renderHighlight(rawFragment: string): React.ReactNode {
  const fragment =
    rawFragment.length > HIGHLIGHT_MAX_LEN
      ? rawFragment.slice(0, HIGHLIGHT_MAX_LEN)
      : rawFragment;
  const pattern = /<mark>([\s\S]*?)<\/mark>/gi;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(fragment))) {
    if (match.index > cursor) nodes.push(fragment.slice(cursor, match.index));
    nodes.push(<mark key={key++}>{match[1]}</mark>);
    cursor = pattern.lastIndex;
  }
  if (cursor < fragment.length) nodes.push(fragment.slice(cursor));
  return nodes.length > 0 ? nodes : fragment;
}

function renderFileIcon(type: DriveFileType): React.ReactNode {
  if (type === "folder") return <FolderOpen size={20} aria-hidden />;
  if (type === "doc") return <FileText size={20} aria-hidden />;
  return <File size={20} aria-hidden />;
}

function formatUpdatedAt(iso: string, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale);
  } catch {
    return "";
  }
}

// space_name + root-first folder chain (path excludes the hit itself).
function breadcrumb(hit: DriveSearchHit): string {
  return [hit.space_name, ...(hit.path ?? [])].filter(Boolean).join(" / ");
}

const DriveSearchPanel: React.FC<DriveSearchPanelProps> = ({
  keyword,
  dataSource,
  isActive = true,
  onOpenDriveHit,
}) => {
  const { t, locale } = useI18n();
  const trimmed = keyword.trim();
  const canSearch = !!trimmed && isActive && !!dataSource.searchDrive;

  const [items, setItems] = useState<DriveSearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [pageIndex, setPageIndex] = useState(0); // current loaded page (0-based)
  const [loading, setLoading] = useState(false); // first page in flight
  const [loadingMore, setLoadingMore] = useState(false); // next page in flight
  const [error, setError] = useState<string | null>(null);
  // Hard stop for offset pagination: set only once a page comes back EMPTY (0
  // items). A short page is NOT enough — SearchService.searchDrive drops
  // malformed rows client-side, so a 20-row backend page carrying one bad row
  // arrives as 19 and would trip a `< PAGE_SIZE` guard, silently under-fetching
  // and reporting "all loaded" over a set of hundreds. The house helper
  // (bridge/channelSearch/pagination.ts shouldPauseAutoPaginationForEmptyPage)
  // takes the same position: stop on empty, not on short. Costs at most one
  // extra empty request but cannot truncate.
  const [reachedEnd, setReachedEnd] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Generation guard: only the latest generation may write state. Bumped when
  // the first page resets, so a stale in-flight response (first page OR next
  // page) is silently dropped — dual protection with AbortController.
  const seqRef = useRef(0);
  // Synchronous in-flight guard keyed on the page index being fetched. React
  // state (loadingMore) commits asynchronously, so under React 18's concurrent
  // root two scroll events dispatched in the same tick both pass the guard
  // reading loadingMore from the render closure — they compute the same
  // nextIndex and both fetch, duplicating rows AND inflating items.length so
  // hasMore stops early. useSearchPagination.ts:51,71-74 defends this exact
  // race with a cursor ref; we key on a numeric page index instead.
  const loadingMorePageRef = useRef<number | null>(null);
  // requestAnimationFrame coalescer for the scroll handler. Multiple scroll
  // events inside one frame collapse to a single loadNextPage call — mirrors
  // useSearchPagination.ts:153-161. Combined with loadingMorePageRef this
  // closes the double-fire race under React 18 concurrent scheduling
  // (yujiawei P1-2 · 2026-08-28).
  const scrollFrameRef = useRef<number | null>(null);

  // Derived: more pages exist while we hold fewer hits than the reported total
  // AND we have not hit a short/empty page (reachedEnd). The backend has no
  // has_more / nextCursor field, so this is the sole gate.
  const hasMore = items.length < total && !reachedEnd;

  // First page: reset + fetch page_index=0 whenever the query / active / source
  // changes. Debounced so a fast typist fires one search per pause.
  useEffect(() => {
    abortRef.current?.abort();
    // Bump the generation on EVERY run — INCLUDING the !canSearch early return
    // below — so any in-flight response (first page or next page) from the prior
    // generation fails its `seq === seqRef.current` guard and cannot write stale
    // items/error back after we reset to the empty state. abort() alone races: a
    // resolve/reject already queued before the abort still lands, and without a
    // seq bump it would pass the guard and pollute the empty state (QA 🔴).
    const seq = ++seqRef.current;
    setItems([]);
    setTotal(0);
    setTruncated(false);
    setPageIndex(0);
    setError(null);
    // Reset the pagination stop so the fresh query can page again.
    setReachedEnd(false);
    // Reset loadingMore too: an in-flight next page whose finally() is now gated
    // out by the seq bump would otherwise leave loadingMore stuck true forever —
    // footer frozen on "loading" and loadNextPage's opening guard blocking every
    // later page. Mirrors the cursor-paged panels' reset (高研 必修🟠).
    setLoadingMore(false);
    if (!canSearch) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => {
      dataSource
        .searchDrive!(
          {
            q: trimmed,
            scope: "all",
            // Exclude folder hits — this panel only opens file previews.
            filters: { types: ["blob", "doc"] },
            page_index: 0,
            page_size: PAGE_SIZE,
          },
          controller.signal
        )
        .then((resp) => {
          if (seq !== seqRef.current) return;
          setItems(resp.items);
          setTotal(resp.total);
          setTruncated(resp.truncated);
          // Only an empty first page ends the walk. A short first page is
          // ambiguous: it may be a genuinely small result set, or a 20-row
          // backend page whose SearchService normalizer dropped a malformed
          // row (post-filter under-count). Trusting the latter would strand
          // the rest of the result set — see reachedEnd docblock.
          if (resp.items.length === 0) setReachedEnd(true);
        })
        .catch((err) => {
          // A cancelled request (AbortError) or a superseded generation is not a
          // failure — drop it silently instead of surfacing a spurious error.
          if (isAbortError(err) || seq !== seqRef.current) return;
          setError(t("base.globalSearch.drive.searchFailed"));
        })
        .finally(() => {
          if (seq === seqRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // t is referentially stable (from I18n context); listing it keeps
    // exhaustive-deps happy without causing a refetch.
  }, [canSearch, trimmed, dataSource, t]);

  // Next page: appended on scroll-to-bottom. Shares the generation number with
  // the first-page effect, so a first-page reset invalidates an in-flight
  // loadNextPage (its captured seq goes stale and its result is dropped).
  const loadNextPage = useCallback(async () => {
    if (loading || loadingMore || !hasMore || !canSearch) return;
    const nextIndex = pageIndex + 1;
    // Sync re-entry guard: two scroll events in the same React commit tick
    // both read loadingMore === false from the render closure and both reach
    // here; the ref check rejects the second one before its setLoadingMore
    // gets scheduled. Cleared in finally so a later legitimate call for the
    // same index (rare, but possible after a keyword-triggered generation
    // reset) is not blocked.
    if (loadingMorePageRef.current === nextIndex) return;
    loadingMorePageRef.current = nextIndex;
    setLoadingMore(true);
    // Clear any stale error so the terminal ("all loaded" / "truncated")
    // footer can surface once this success lands (a prior transient failure
    // would otherwise pin "Search failed" for the rest of the query).
    setError(null);
    const seq = seqRef.current;
    try {
      // Share the current generation's controller so a keyword switch mid-page
      // cancels this request too (the first-page effect already called abort()).
      const resp = await dataSource.searchDrive!(
        {
          q: trimmed,
          scope: "all",
          // Keep the folder-exclusion filter consistent across pages.
          filters: { types: ["blob", "doc"] },
          page_index: nextIndex,
          page_size: PAGE_SIZE,
        },
        abortRef.current?.signal
      );
      if (seq !== seqRef.current) return;
      setItems((prev) => [...prev, ...resp.items]);
      setPageIndex(nextIndex);
      setTotal(resp.total); // total normally stable; follow backend if it moves
      setTruncated(resp.truncated);
      // Stop paging only once a page comes back truly empty. A short page is
      // ambiguous under a post-filter normalizer (see reachedEnd docblock).
      if (resp.items.length === 0) setReachedEnd(true);
    } catch (err) {
      // Cancelled request or superseded generation: drop it, never show an error.
      if (isAbortError(err) || seq !== seqRef.current) return;
      setError(t("base.globalSearch.drive.searchFailed"));
    } finally {
      // Always release the sync in-flight lock, even for stale generations —
      // otherwise a keyword switch mid-page leaves the lock latched on the
      // old index and later loads for the same index are blocked forever.
      loadingMorePageRef.current = null;
      if (seq === seqRef.current) setLoadingMore(false);
    }
  }, [
    loading,
    loadingMore,
    hasMore,
    canSearch,
    pageIndex,
    trimmed,
    dataSource,
    t,
  ]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const nearBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD_PX;
      if (!nearBottom) return;
      // rAF coalescer: many scroll events per frame collapse to one
      // loadNextPage call per frame. Belt-and-suspenders with the
      // loadingMorePageRef sync guard closes the React 18 concurrent race
      // (yujiawei P1-2 · 2026-08-28).
      if (typeof window.requestAnimationFrame !== "function") {
        void loadNextPage();
        return;
      }
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        void loadNextPage();
      });
    },
    [loadNextPage]
  );

  // Cancel a pending rAF on unmount so we don't call setState (or worse, a
  // stale loadNextPage closure) after the panel is gone.
  useEffect(() => {
    return () => {
      if (
        scrollFrameRef.current !== null &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, []);

  const emptyState = useMemo(() => {
    if (loading) {
      return (
        <div className="wk-drive-search__hint">
          {t("base.globalSearch.drive.loading")}
        </div>
      );
    }
    if (error) {
      return <div className="wk-drive-search__hint">{error}</div>;
    }
    return (
      <div className="wk-drive-search__empty">
        {!trimmed
          ? t("base.globalSearch.drive.emptyHint")
          : t("base.globalSearch.drive.noResults")}
      </div>
    );
  }, [error, loading, t, trimmed]);

  return (
    <div className="wk-drive-search">
      <div className="wk-drive-search__list" onScroll={handleScroll}>
        {items.length === 0
          ? emptyState
          : items.map((hit) => {
              const bodySnippets = (hit.highlights?.body ?? []).slice(
                0,
                BODY_SNIPPET_MAX
              );
              const crumb = breadcrumb(hit);
              return (
                <button
                  type="button"
                  key={`${hit.space_id}:${hit.file_id}`}
                  className="wk-drive-search__item"
                  onClick={() => onOpenDriveHit?.(hit)}
                >
                  <span
                    className={`wk-drive-search__icon wk-drive-search__icon--${hit.type}`}
                  >
                    {renderFileIcon(hit.type)}
                  </span>
                  <span className="wk-drive-search__meta">
                    <span className="wk-drive-search__title">
                      {hit.highlights?.name?.[0]
                        ? renderHighlight(hit.highlights.name[0])
                        : hit.name}
                    </span>
                    {crumb && (
                      <span className="wk-drive-search__crumb">{crumb}</span>
                    )}
                    {bodySnippets.length > 0 ? (
                      bodySnippets.map((frag, i) => (
                        <span key={i} className="wk-drive-search__snippet">
                          {renderHighlight(frag)}
                        </span>
                      ))
                    ) : (
                      <span className="wk-drive-search__sub">
                        {[
                          hit.owner_name,
                          formatUpdatedAt(hit.updated_at, locale),
                          typeof hit.size === "number"
                            ? formatFileSize(hit.size)
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
        {/* Bottom hints (only once the first page has results). Priority:
            loadingMore spinner > paging error > truncated note > all-loaded. */}
        {items.length > 0 && loadingMore && (
          <div className="wk-drive-search__footer" role="status">
            {t("base.globalSearch.drive.loading")}
          </div>
        )}
        {items.length > 0 && !loadingMore && error && (
          <div className="wk-drive-search__footer">{error}</div>
        )}
        {items.length > 0 && !loadingMore && !error && truncated && (
          <div className="wk-drive-search__footer" role="status">
            {t("base.globalSearch.drive.truncated")}
          </div>
        )}
        {items.length > 0 &&
          !loadingMore &&
          !error &&
          !truncated &&
          !hasMore && (
            <div className="wk-drive-search__footer" role="status">
              {/* Count the rows actually rendered, not backend `total`: `total`
                  counts pre-permission/pre-filter rows, so on a short/empty
                  page (reachedEnd) it overstates what the user sees. */}
              {t("base.globalSearch.drive.allLoaded", {
                values: { count: items.length },
              })}
            </div>
          )}
      </div>
    </div>
  );
};

export default DriveSearchPanel;
