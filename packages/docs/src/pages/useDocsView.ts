// Per-tab data engine for the docs list (frontend-design §2.1 / §2.2).
//
// Each list tab ("recent" 最近查看 / "mine" 我的文档) owns ONE `useDocsView` instance holding its
// own search term, creator filter, items, pagination cursor/page and status. The container
// (DocsList) keeps two instances alive at once and simply swaps which one is active on tab switch —
// so per-view search + filter state survives a switch and is restored (with its request re-sent)
// when the user comes back (AC-2.3.2 / product MC5).
//
// Loading state is plain `useState` + conditional rendering — NO Suspense. The host renders docs
// inside a MobX observer that force-updates at high frequency, which starves React 18's low-priority
// Suspense RetryLane commits (see module.tsx commit-starvation note); a Suspense boundary here would
// hang the list. IntersectionObserver drives pagination (see InfiniteList), not scroll events.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listDocs,
  listRecentDocs,
  listRecentCreators,
  type CreatorOption,
  type DocListItem,
} from './docsApi.ts'

export type DocsViewKind = 'recent' | 'mine'

/** First-page / result-set level status. Footer (load-more) state is tracked separately below. */
export type DocsViewPhase = 'loading' | 'ready' | 'error'

/**
 * Empty-state variant (frontend-design §5.3). `null` = not empty. A/B distinguish "view has no data"
 * (看 vs 建, dual CTA i18n keys); C/D/E distinguish "conditions matched nothing" (search / filter /
 * both). Decided from the (q, creators) that produced the empty result — never stale state.
 */
export type DocsEmptyKind = null | 'A' | 'B' | 'C' | 'D' | 'E'

/** Footer status for the infinite-scroll appends (independent of the first-page phase). */
export type DocsMoreStatus = 'idle' | 'loadingMore' | 'error' | 'end'

/** Default first-page / append size. Backend default is 20; kept modest to stay snappy on open. */
const PAGE_SIZE = 20

export interface DocsView {
  readonly kind: DocsViewKind
  q: string
  /** Selected creator uids (recent only; always empty for mine). */
  creators: string[]
  /** Facet candidates for the creator filter (recent only), server-resolved `{uid,name}`. */
  creatorOptions: CreatorOption[]
  items: DocListItem[]
  total: number
  phase: DocsViewPhase
  empty: DocsEmptyKind
  hasMore: boolean
  moreStatus: DocsMoreStatus
  /** Bumped on every new result set so the scroll container can reset to the top. */
  resultSetId: number
  /** Set the search term and refetch a fresh result set (caller debounces the keystrokes). */
  setQuery: (q: string) => void
  /** Clear the search term (empty-state C/E "clear search" CTA). */
  clearQuery: () => void
  /** Toggle a creator uid in the OR filter (recent only). */
  toggleCreator: (uid: string) => void
  /** Clear all selected creators (empty-state D/E "clear filter" CTA + chips "clear all"). */
  clearCreators: () => void
  /** Append the next page (IntersectionObserver sentinel / load-more retry). */
  loadMore: () => void
  /** Retry a failed first-page load. */
  retry: () => void
  /** Refetch the current result set from scratch (e.g. after a rename bumps the reload token). */
  reload: () => void
}

function deriveEmpty(
  kind: DocsViewKind,
  itemsLen: number,
  q: string,
  creators: string[],
): DocsEmptyKind {
  if (itemsLen > 0) return null
  const hasQ = q.trim().length > 0
  const hasCreators = creators.length > 0
  if (hasQ && hasCreators) return 'E'
  if (hasCreators) return 'D'
  if (hasQ) return 'C'
  return kind === 'recent' ? 'A' : 'B'
}

/**
 * Manage one tab's list state. `space` / `folder` scope the queries; when either changes the current
 * result set is refetched (the container passes the live space so a Space switch reconciles here).
 * `reloadToken` (bumped by the parent after a rename/delete) forces a refresh without changing q/creators.
 */
export function useDocsView(
  kind: DocsViewKind,
  space: string,
  folder: string,
  reloadToken: number,
): DocsView {
  const [q, setQ] = useState('')
  const [creators, setCreators] = useState<string[]>([])
  const [creatorOptions, setCreatorOptions] = useState<CreatorOption[]>([])
  const [items, setItems] = useState<DocListItem[]>([])
  const [total, setTotal] = useState(0)
  const [phase, setPhase] = useState<DocsViewPhase>('loading')
  const [empty, setEmpty] = useState<DocsEmptyKind>(null)
  const [hasMore, setHasMore] = useState(false)
  const [moreStatus, setMoreStatus] = useState<DocsMoreStatus>('idle')
  const [resultSetId, setResultSetId] = useState(0)

  // Monotonic sequence — every request stamps it; only the LATEST request's response may touch state
  // (frontend-design §2.3). Covers tab switch / search / filter / paging races. A ref survives
  // re-renders without triggering one.
  const seqRef = useRef(0)
  // Pagination position for the NEXT append. recent = opaque keyset cursor; mine = offset page.
  const cursorRef = useRef<string | null>(null)
  const pageRef = useRef(1)
  const hasMoreRef = useRef(false)
  // Loaded row count for the current result set — lets mine's offset paging decide `hasMore` against
  // `total` without a side-effect inside a setState updater.
  const loadedRef = useRef(0)
  // Synchronous in-flight guard for appends. `moreStatus` is React state: `setMoreStatus` is async,
  // and InfiniteList's `loadMoreRef` only points at the fresh callback after a commit, so under fast
  // scroll / reflow a second IntersectionObserver notification can re-enter loadMore before the
  // state (and thus the state-based guard) reflects the first — firing a duplicate request for the
  // same cursor/page and appending it twice (duplicate rows + corrupted cursor, AC-6.4). A ref flips
  // synchronously in the same tick, so the re-entrant call is dropped before it issues a request.
  const loadingMoreRef = useRef(false)

  const fetchFirst = useCallback(
    (nextQ: string, nextCreators: string[]) => {
      const seq = ++seqRef.current
      cursorRef.current = null
      pageRef.current = 1
      // A fresh result set supersedes any in-flight append (its settle will no-op on the seq check),
      // so release the in-flight guard here rather than in that stale settle.
      loadingMoreRef.current = false
      setPhase('loading')
      setEmpty(null)
      setMoreStatus('idle')

      const done = (fetched: DocListItem[], nextTotal: number, more: boolean) => {
        if (seq !== seqRef.current) return
        setItems(fetched)
        setTotal(nextTotal)
        loadedRef.current = fetched.length
        hasMoreRef.current = more
        setHasMore(more)
        setMoreStatus(more ? 'idle' : 'end')
        setEmpty(deriveEmpty(kind, fetched.length, nextQ, nextCreators))
        setPhase('ready')
        setResultSetId((n) => n + 1)
      }
      const fail = (err: unknown) => {
        if (seq !== seqRef.current) return
        console.error('[docs] list failed', err)
        setPhase('error')
      }

      if (kind === 'recent') {
        // Refresh the creator candidates for this new result set (candidates track `q`, but are
        // independent of the selected creators and pagination — §3.5). Fire in parallel; drop if
        // superseded. name resolution failures just yield fewer / uid-labelled options.
        void listRecentCreators(nextQ)
          .then((opts) => {
            if (seq === seqRef.current) setCreatorOptions(opts)
          })
          .catch(() => {})
        listRecentDocs({ q: nextQ, creators: nextCreators, cursor: null, pageSize: PAGE_SIZE })
          .then((res) => {
            cursorRef.current = res.nextCursor
            done(res.items, res.total, !!res.nextCursor && res.items.length > 0)
          })
          .catch(fail)
      } else {
        listDocs({
          spaceId: space || undefined,
          folderId: folder || undefined,
          sort: 'updatedAt:desc',
          owner: 'me',
          q: nextQ,
          page: 1,
          pageSize: PAGE_SIZE,
        })
          .then((res) => {
            pageRef.current = 1
            done(res.items, res.total, res.items.length > 0 && res.items.length < res.total)
          })
          .catch(fail)
      }
    },
    [kind, space, folder],
  )

  const loadMore = useCallback(() => {
    if (!hasMoreRef.current) return
    if (seqRef.current === 0) return
    // Synchronous re-entrancy guard: drop the call if an append is already in flight for this result
    // set (see loadingMoreRef above — a ref, not `moreStatus`, so a same-tick duplicate is caught).
    if (loadingMoreRef.current) return
    const seq = seqRef.current
    loadingMoreRef.current = true
    setMoreStatus('loadingMore')

    const append = (fetched: DocListItem[], more: boolean) => {
      if (seq !== seqRef.current) return
      loadingMoreRef.current = false
      loadedRef.current += fetched.length
      setItems((prev) => [...prev, ...fetched])
      hasMoreRef.current = more
      setHasMore(more)
      setMoreStatus(more ? 'idle' : 'end')
    }
    const fail = () => {
      if (seq !== seqRef.current) return
      loadingMoreRef.current = false
      // Keep the already-loaded rows; surface a retryable footer error (frontend-design §5.5).
      setMoreStatus('error')
    }

    if (kind === 'recent') {
      listRecentDocs({ q, creators, cursor: cursorRef.current, pageSize: PAGE_SIZE })
        .then((res) => {
          if (seq !== seqRef.current) return
          cursorRef.current = res.nextCursor
          append(res.items, !!res.nextCursor && res.items.length > 0)
        })
        .catch(fail)
    } else {
      const nextPage = pageRef.current + 1
      listDocs({
        spaceId: space || undefined,
        folderId: folder || undefined,
        sort: 'updatedAt:desc',
        owner: 'me',
        q,
        page: nextPage,
        pageSize: PAGE_SIZE,
      })
        .then((res) => {
          if (seq !== seqRef.current) return
          pageRef.current = nextPage
          // With offset paging, "more" = a full page landed AND we're still short of `total`.
          const more =
            res.items.length === PAGE_SIZE && loadedRef.current + res.items.length < res.total
          append(res.items, more)
        })
        .catch(fail)
    }
  }, [kind, q, creators, space, folder])

  const setQuery = useCallback(
    (next: string) => {
      setQ(next)
      fetchFirst(next, creators)
    },
    [creators, fetchFirst],
  )

  const clearQuery = useCallback(() => {
    setQ('')
    fetchFirst('', creators)
  }, [creators, fetchFirst])

  const toggleCreator = useCallback(
    (uid: string) => {
      const next = creators.includes(uid)
        ? creators.filter((u) => u !== uid)
        : [...creators, uid]
      setCreators(next)
      fetchFirst(q, next)
    },
    [creators, q, fetchFirst],
  )

  const clearCreators = useCallback(() => {
    setCreators([])
    fetchFirst(q, [])
  }, [q, fetchFirst])

  const retry = useCallback(() => {
    fetchFirst(q, creators)
  }, [q, creators, fetchFirst])

  const reload = useCallback(() => {
    fetchFirst(q, creators)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, creators, fetchFirst])

  // Initial load + refetch when the space/folder changes (a Space switch reconciles here) or the
  // parent bumps reloadToken (rename/delete). Search/creator changes go through their own setters,
  // which preserve per-view state; this effect intentionally leaves q/creators untouched so a Space
  // switch keeps the tab's remembered search + filter and re-sends them (AC-2.3.2).
  useEffect(() => {
    fetchFirst(q, creators)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, folder, reloadToken])

  return {
    kind,
    q,
    creators,
    creatorOptions,
    items,
    total,
    phase,
    empty,
    hasMore,
    moreStatus,
    resultSetId,
    setQuery,
    clearQuery,
    toggleCreator,
    clearCreators,
    loadMore,
    retry,
    reload,
  }
}
