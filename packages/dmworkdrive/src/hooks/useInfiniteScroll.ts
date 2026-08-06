import { useEffect, useRef } from 'react';

export interface UseInfiniteScrollOptions {
  /** Whether more data is available; when false the observer is skipped. */
  hasMore: boolean;
  /** Whether a load is already in flight; when true the observer is skipped. */
  loading: boolean;
  /** Called once when the sentinel intersects the viewport. */
  onLoadMore: () => void;
  /**
   * IntersectionObserver rootMargin so the load fires slightly before the
   * user hits the very bottom. Defaults to '200px' — one full row plus
   * padding, so the next page is landing as the user reaches the end
   * rather than after they stop scrolling.
   */
  rootMargin?: string;
}

/**
 * Attach the returned ref to an element rendered at the end of the list;
 * once it scrolls into view (or near-view via rootMargin) `onLoadMore` is
 * called. The observer is torn down and rebuilt whenever `hasMore` or
 * `loading` flip, so we never fire loadMore twice for one intersection
 * and never keep an observer alive on a sentinel that no longer needs it.
 */
export function useInfiniteScroll<T extends HTMLElement>({
  hasMore,
  loading,
  onLoadMore,
  rootMargin = '200px',
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<T | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') return; // SSR / jsdom fallback

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onLoadMoreRef.current();
            return;
          }
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, rootMargin]);

  return sentinelRef;
}
