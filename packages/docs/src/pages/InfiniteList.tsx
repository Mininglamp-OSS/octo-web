import { useEffect, useRef } from 'react'
import { t } from '../octoweb/index.ts'
import type { DocListItem } from './docsApi.ts'
import type { DocsMoreStatus } from './useDocsView.ts'

/**
 * The scrollable list body with IntersectionObserver-driven pagination (frontend-design §2.3 / §5.5).
 *
 * A `sentinel` at the bottom of the scroll container is observed; when it enters the viewport we
 * append the next page. NO Suspense / React.lazy is used for loading state — the host's MobX observer
 * force-updates at high frequency and would starve React 18's Suspense RetryLane commits; the footer
 * is plain conditional rendering instead. The observer is rebuilt whenever `hasMore` flips or the
 * result set changes, and disconnected once there is nothing more to load.
 */
export function InfiniteList({
  items,
  renderRow,
  hasMore,
  moreStatus,
  resultSetId,
  onLoadMore,
}: {
  items: DocListItem[]
  renderRow: (item: DocListItem) => React.ReactNode
  hasMore: boolean
  moreStatus: DocsMoreStatus
  /** Bumped by the view on each new result set — resets the scroll position to the top. */
  resultSetId: number
  onLoadMore: () => void
}): React.ReactElement {
  const scrollRef = useRef<HTMLUListElement>(null)
  const sentinelRef = useRef<HTMLLIElement>(null)
  // Keep the latest onLoadMore without re-subscribing the observer on every render.
  const loadMoreRef = useRef(onLoadMore)
  useEffect(() => {
    loadMoreRef.current = onLoadMore
  }, [onLoadMore])

  // Reset scroll to the top when a brand-new result set arrives (tab switch / search / filter).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [resultSetId])

  useEffect(() => {
    const sentinel = sentinelRef.current
    const root = scrollRef.current
    if (!sentinel || !root) return
    if (!hasMore) return
    // Guard environments without IntersectionObserver (older jsdom): pagination degrades to the
    // manual "load more" affordance rendered in the footer below.
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            loadMoreRef.current()
            break
          }
        }
      },
      { root, rootMargin: '120px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [hasMore, resultSetId])

  return (
    <ul className="octo-docs-list-items" ref={scrollRef}>
      {items.map(renderRow)}
      {(hasMore || moreStatus === 'loadingMore' || moreStatus === 'error') && (
        <li ref={sentinelRef} className="octo-docs-list-more" aria-hidden="true">
          {moreStatus === 'loadingMore' && (
            <span className="octo-docs-list-more-loading">{t('docs.list.loadingMore')}</span>
          )}
          {moreStatus === 'error' && (
            <span className="octo-docs-list-more-error">
              {t('docs.list.loadMoreFailed')}
              <button
                type="button"
                className="octo-docs-list-retry"
                onClick={() => loadMoreRef.current()}
              >
                {t('docs.list.retry')}
              </button>
            </span>
          )}
          {moreStatus === 'idle' && hasMore && (
            // Fallback affordance when IntersectionObserver can't reach the sentinel (e.g. very tall
            // viewport, or no IO support). Clicking loads the next page.
            <button
              type="button"
              className="octo-docs-list-more-btn"
              onClick={() => loadMoreRef.current()}
            >
              {t('docs.list.loadingMore')}
            </button>
          )}
        </li>
      )}
      {!hasMore && moreStatus === 'end' && items.length > 0 && (
        <li className="octo-docs-list-end" aria-hidden="true">
          {t('docs.list.end')}
        </li>
      )}
    </ul>
  )
}
