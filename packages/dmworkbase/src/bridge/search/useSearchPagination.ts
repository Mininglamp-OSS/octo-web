import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type UIEventHandler,
} from "react";
import {
  isNearChannelSearchScrollBottom,
  shouldPauseAutoPaginationForEmptyPage,
  shouldStopPaginationForCursor,
} from "../channelSearch/pagination";

export interface SearchPage<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

// Append `next` onto `prev`, dropping any `next` item whose dedupeKey already
// appeared (first occurrence wins). Without a dedupeKey this is a plain concat.
function mergeDedup<T>(
  prev: T[],
  next: T[],
  dedupeKey?: (item: T) => string
): T[] {
  if (!dedupeKey) return [...prev, ...next];
  const seen = new Set(prev.map(dedupeKey));
  const merged = [...prev];
  for (const item of next) {
    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

export interface UseSearchPaginationOptions<T> {
  enabled: boolean;
  search: (cursor?: string) => Promise<SearchPage<T>>;
  errorMessage: string;
  debounceMs?: number;
  // Optional identity extractor. When provided, items merged across pages are
  // deduped by this key (first occurrence wins). Offset-based paging (e.g.
  // docs search, which has no stable cursor) can repeat a row across pages
  // under index churn; without this the repeat would collide React keys.
  dedupeKey?: (item: T) => string;
}

export function useSearchPagination<T>({
  enabled,
  search,
  errorMessage,
  debounceMs = 300,
  dedupeKey,
}: UseSearchPaginationOptions<T>) {
  const [response, setResponse] = useState<SearchPage<T>>({
    items: [],
    hasMore: false,
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [queryStarted, setQueryStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [autoPaginationPaused, setAutoPaginationPaused] = useState(false);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const loadingMoreCursorRef = useRef<string | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      if (
        scrollFrameRef.current !== null &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  const runSearch = useCallback(
    async (cursor?: string) => {
      if (!enabled || (cursor && loadingMoreCursorRef.current === cursor)) {
        return;
      }
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
        const next = await search(cursor);
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        const stopPagination = shouldStopPaginationForCursor({
          hasMore: next.hasMore,
          nextCursor: next.nextCursor,
          requestedCursor: cursor,
        });
        setAutoPaginationPaused(
          shouldPauseAutoPaginationForEmptyPage({
            hasMore: next.hasMore,
            itemCount: next.items.length,
            nextCursor: next.nextCursor,
            requestedCursor: cursor,
          })
        );
        setResponse((previous) => ({
          items: cursor
            ? mergeDedup(previous.items, next.items, dedupeKey)
            : next.items,
          nextCursor: stopPagination ? undefined : next.nextCursor,
          hasMore: stopPagination ? false : next.hasMore,
        }));
      } catch {
        if (mountedRef.current && requestIdRef.current === requestId) {
          if (cursor) setPaginationError(errorMessage);
          else setError(errorMessage);
        }
      } finally {
        if (mountedRef.current && requestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
          if (loadingMoreCursorRef.current === cursor) {
            loadingMoreCursorRef.current = null;
          }
        }
      }
    },
    [dedupeKey, enabled, errorMessage, search]
  );

  const loadNextPage = useCallback(
    (force = false) => {
      if (loading || loadingMore || !response.hasMore || !response.nextCursor) {
        return;
      }
      if ((paginationError || autoPaginationPaused) && !force) return;
      void runSearch(response.nextCursor);
    },
    [
      autoPaginationPaused,
      loading,
      loadingMore,
      paginationError,
      response.hasMore,
      response.nextCursor,
      runSearch,
    ]
  );

  const maybeLoadNextPage = useCallback(() => {
    const content = contentRef.current;
    if (content && isNearChannelSearchScrollBottom(content)) loadNextPage();
  }, [loadNextPage]);

  const handleScroll: UIEventHandler<HTMLDivElement> = useCallback(() => {
    if (typeof window.requestAnimationFrame !== "function") {
      maybeLoadNextPage();
      return;
    }
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      maybeLoadNextPage();
    });
  }, [maybeLoadNextPage]);

  useEffect(() => {
    requestIdRef.current += 1;
    loadingMoreCursorRef.current = null;
    setResponse({ items: [], hasMore: false });
    setLoadingMore(false);
    setError(null);
    setPaginationError(null);
    setAutoPaginationPaused(false);
    if (!enabled) {
      setQueryStarted(false);
      setLoading(false);
      return;
    }
    setQueryStarted(true);
    setLoading(true);
    const timer = window.setTimeout(() => void runSearch(), debounceMs);
    return () => window.clearTimeout(timer);
  }, [debounceMs, enabled, runSearch]);

  useEffect(() => {
    maybeLoadNextPage();
  }, [maybeLoadNextPage, response.items.length]);

  return {
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
  };
}

export default useSearchPagination;
