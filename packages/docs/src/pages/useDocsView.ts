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
  type DocType,
} from './docsApi.ts'

export type DocsViewKind = 'recent' | 'mine'

/** First-page / result-set level status. Footer (load-more) state is tracked separately below. */
export type DocsViewPhase = 'loading' | 'ready' | 'error'

/**
 * Empty-state variant (frontend-design §5.3). `null` = not empty. A/B distinguish "view has no data"
 * (看 vs 建, dual CTA i18n keys); C/D/E/F distinguish "conditions matched nothing" (search / creator
 * / both / type). Decided from the (q, creators, types) that produced the empty result — never stale
 * state. `E` is the combined bucket for ANY 2+ active conditions and shows every matching clear.
 */
export type DocsEmptyKind = null | 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

/** Footer status for the infinite-scroll appends (independent of the first-page phase). */
export type DocsMoreStatus = 'idle' | 'loadingMore' | 'error' | 'end'

/** Default first-page / append size. Backend default is 20; kept modest to stay snappy on open. */
const PAGE_SIZE = 20

export interface DocsView {
  readonly kind: DocsViewKind
  q: string
  /** Selected creator uids (recent only; always empty for mine). */
  creators: string[]
  /** Selected document kinds — multi-select OR filter (both tabs; frontend-design §5.2). */
  types: DocType[]
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
  /** Toggle a document kind in the OR filter (both tabs). */
  toggleType: (ty: DocType) => void
  /** Clear all selected types (empty-state F/E "clear type" CTA + chips "clear all"). */
  clearTypes: () => void
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
  types: DocType[],
): DocsEmptyKind {
  if (itemsLen > 0) return null
  const hasQ = q.trim().length > 0
  const hasCreators = creators.length > 0
  const hasTypes = types.length > 0
  const active = (hasQ ? 1 : 0) + (hasCreators ? 1 : 0) + (hasTypes ? 1 : 0)
  // 2+ active conditions collapse to the combined bucket, which renders every matching clear CTA.
  if (active >= 2) return 'E'
  if (hasQ) return 'C'
  if (hasCreators) return 'D'
  if (hasTypes) return 'F'
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
  const [types, setTypes] = useState<DocType[]>([])
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
    (nextQ: string, nextCreators: string[], nextTypes: DocType[], refreshCreatorFacet = true) => {
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
        setEmpty(deriveEmpty(kind, fetched.length, nextQ, nextCreators, nextTypes))
        setPhase('ready')
        setResultSetId((n) => n + 1)
      }
      const fail = (err: unknown) => {
        if (seq !== seqRef.current) return
        console.error('[docs] list failed', err)
        setPhase('error')
      }

      if (kind === 'recent') {
        // Refresh the creator candidates only when `q` actually changed (or on a full reconcile:
        // mount / space / folder / reload / retry) — candidates track `q` and are independent of the
        // selected creators/types and pagination (§3.5). Selection toggles keep the SAME `q`, so they
        // pass refreshCreatorFacet=false: this aligns the creator filter's selection behaviour with
        // the type filter (whose candidate set is a fixed enum and never reloads mid-select), keeping
        // the open dropdown's candidate list stable while multi-selecting instead of re-fetching and
        // reordering it on every checkbox click. The server-facet source and `q`-tracking semantics
        // are unchanged — only the redundant refetch on selection is dropped. Fire in parallel; drop
        // if superseded. name resolution failures just yield fewer / uid-labelled options.
        if (refreshCreatorFacet) {
          void listRecentCreators(nextQ)
            .then((opts) => {
              if (seq === seqRef.current) setCreatorOptions(opts)
            })
            .catch(() => {})
        }
        listRecentDocs({ q: nextQ, creators: nextCreators, types: nextTypes, cursor: null, pageSize: PAGE_SIZE })
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
          types: nextTypes,
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
      listRecentDocs({ q, creators, types, cursor: cursorRef.current, pageSize: PAGE_SIZE })
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
        types,
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
  }, [kind, q, creators, types, space, folder])

  const setQuery = useCallback(
    (next: string) => {
      setQ(next)
      fetchFirst(next, creators, types)
    },
    [creators, types, fetchFirst],
  )

  const clearQuery = useCallback(() => {
    setQ('')
    fetchFirst('', creators, types)
  }, [creators, types, fetchFirst])

  const toggleCreator = useCallback(
    (uid: string) => {
      const next = creators.includes(uid)
        ? creators.filter((u) => u !== uid)
        : [...creators, uid]
      setCreators(next)
      // Selection toggle keeps `q` — don't reload the creator facet candidates (aligns with the
      // type filter's stable candidate set; see fetchFirst's recent branch).
      fetchFirst(q, next, types, false)
    },
    [creators, q, types, fetchFirst],
  )

  const clearCreators = useCallback(() => {
    setCreators([])
    fetchFirst(q, [], types, false)
  }, [q, types, fetchFirst])

  const toggleType = useCallback(
    (ty: DocType) => {
      const next = types.includes(ty) ? types.filter((x) => x !== ty) : [...types, ty]
      setTypes(next)
      fetchFirst(q, creators, next, false)
    },
    [types, q, creators, fetchFirst],
  )

  const clearTypes = useCallback(() => {
    setTypes([])
    fetchFirst(q, creators, [], false)
  }, [q, creators, fetchFirst])

  const retry = useCallback(() => {
    fetchFirst(q, creators, types)
  }, [q, creators, types, fetchFirst])

  const reload = useCallback(() => {
    fetchFirst(q, creators, types)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, creators, types, fetchFirst])

  // Initial load + refetch when the space/folder changes (a Space switch reconciles here) or the
  // parent bumps reloadToken (rename/delete). Search/creator/type changes go through their own
  // setters, which preserve per-view state; this effect intentionally leaves q/creators/types
  // untouched so a Space switch keeps the tab's remembered search + filters and re-sends them
  // (AC-2.3.2).
  useEffect(() => {
    fetchFirst(q, creators, types)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, folder, reloadToken])

  return {
    kind,
    q,
    creators,
    types,
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
    toggleType,
    clearTypes,
    loadMore,
    retry,
    reload,
  }
}
