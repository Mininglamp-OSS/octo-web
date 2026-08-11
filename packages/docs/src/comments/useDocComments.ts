// Comment data hook (feature #3 §).
//
// Owns the comment thread list for a doc (the single source of truth that both the panel and the
// highlight decoration layer read). Loads roots-with-replies over REST, paginates by cursor, toggles
// resolved visibility, and exposes the mutating actions (create/reply/edit/resolve/delete) which all
// refresh from the server afterwards — the backend is authoritative, so we re-read rather than guess.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CommentApiError,
  listComments,
  getCommentThread,
  createRootComment,
  createReply,
  editCommentBody,
  setCommentResolved,
  deleteComment,
  type CommentThread,
  type CreateRootInput,
} from './api.ts'
import { t } from '../octoweb/index.ts'

const PAGE_SIZE = 25

/**
 * How often the open document silently re-reads the comment list.
 *
 * 15s is a deliberate middle: a Bot edit takes tens of seconds to land, so anything much longer and
 * the reply still feels lost, while anything much shorter multiplies GETs across every open tab for
 * a list that changes rarely. Exported so tests can drive the timer without hard-coding the number.
 */
export const COMMENT_POLL_INTERVAL_MS = 15_000

export interface CommentMutationResult {
  ok: boolean
  error: string | null
  status?: number
  code?: string
}

type CommentAction = 'add' | 'reply' | 'edit' | 'resolve' | 'reopen' | 'delete'

function mutationErrorMessage(action: CommentAction, cause: unknown): string {
  const status = cause instanceof CommentApiError ? cause.status : undefined
  const reason = status === 403 ? 'forbidden'
    : status === 404 ? 'notFound'
      : status === 409 ? 'conflict'
        : status == null ? 'network'
          : 'generic'
  return t(`docs.comment.errors.${action}.${reason}`)
}

export interface UseDocComments {
  threads: CommentThread[]
  loading: boolean
  loadingThreadIds: ReadonlySet<number>
  error: string | null
  nextCursor: number | null
  includeResolved: boolean
  setIncludeResolved: (v: boolean) => void
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  loadThread: (id: number) => Promise<boolean | null>
  createRoot: (input: CreateRootInput) => Promise<CommentMutationResult>
  reply: (parentId: number, body: string) => Promise<CommentMutationResult>
  editBody: (id: number, body: string) => Promise<CommentMutationResult>
  resolve: (id: number, resolved: boolean) => Promise<CommentMutationResult>
  remove: (id: number, hard: boolean) => Promise<CommentMutationResult>
}

export function useDocComments(docId: string): UseDocComments {
  const [threads, setThreads] = useState<CommentThread[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [includeResolved, setIncludeResolved] = useState(false)

  // Stale-guard: a slow earlier refresh must not overwrite a newer one's result
  // (e.g. toggling includeResolved or a mutation-triggered refresh racing a manual
  // one). Each refresh/loadMore takes a monotonic token; only the latest applies.
  // This token is also loading-bearing: refresh/loadMore reset the spinner in
  // `finally` only when it still holds their token.
  const reqRef = useRef(0)

  // Independent stale-guard for reconcile(), deliberately separate from reqRef.
  // reconcile() must NOT claim a reqRef token: bumping it here would make an
  // in-flight refresh/loadMore see a superseded token and skip its own
  // `finally { setLoading(false) }`, while reconcile never touches loading —
  // stranding the spinner true forever and deadlocking pagination. reconcile is
  // a best-effort fallback re-read, not a loading-bearing load, so it owns this
  // token only to guard against a newer reconcile overwriting it.
  const reconcileRef = useRef(0)
  const nextThreadReqRef = useRef(0)
  const activeThreadReqRef = useRef(new Map<number, number>())
  const [loadingThreadIds, setLoadingThreadIds] = useState<ReadonlySet<number>>(() => new Set())

  // Data-freshness epoch, deliberately independent of both tokens above and of the
  // loading lifecycle. reconcile() bumps it after it installs the server's
  // authoritative list; refresh/loadMore snapshot it at start and drop their result
  // (without touching their own loading reset) if a reconcile bumped it while their
  // GET was in flight. This is what invalidates a load that was ALREADY in flight when
  // the reconcile ran: reconcile can't use reqRef for that (it must not bump reqRef, or
  // it would strand an in-flight loader's spinner — see reconcileRef above), so an
  // in-flight loadMore capturing a page that still contained a since-deleted row would
  // otherwise append it back after reconcile dropped it (the "phantom row" race).
  // dataEpoch closes exactly that gap while keeping loading lifecycle and data freshness
  // fully decoupled.
  const dataEpoch = useRef(0)
  // Durable depth raised only by explicit user loadMore actions. Recovery may display one extra
  // bounded tail-probe page, but must not turn that probe into ever-growing refresh work.
  const loadedPageCountRef = useRef(1)
  // Actual number of pages represented in `threads`. A successful tail probe can make this exactly
  // one page deeper than the durable depth. Mutation reconciliation must replay this displayed
  // window so a rejected edit/delete cannot make already-visible comments disappear.
  const displayedPageCountRef = useRef(1)

  const paginationScopeRef = useRef(`${docId}:${includeResolved}`)
  const hasLoadedScopeRef = useRef(false)

  const refresh = useCallback(async () => {
    const token = ++reqRef.current
    const startEpoch = dataEpoch.current
    const scope = `${docId}:${includeResolved}`
    const scopeChanged = paginationScopeRef.current !== scope
    // A scope transition is speculative until its replacement list installs successfully. Keep the
    // old scope/depth metadata untouched while the request is in flight (and on failure), because
    // the old threads/cursor remain installed atomically too.
    const loadedDepth = scopeChanged ? 1 : Math.max(1, loadedPageCountRef.current)
    const displayedDepth = scopeChanged ? 1 : Math.max(1, displayedPageCountRef.current)
    // One additional page beyond the durable user depth is a bounded tail probe. Replaying at least
    // the currently displayed depth keeps a previous probe page visible, while max(..., depth + 1)
    // prevents repeated focus/reconnect refreshes from growing the window without user action.
    const pagesToReload = !scopeChanged && hasLoadedScopeRef.current
      ? Math.max(displayedDepth, loadedDepth + 1)
      : displayedDepth
    setLoading(true)
    setError(null)
    try {
      const items: CommentThread[] = []
      const seen = new Set<number>()
      let cursor: number | undefined
      let nextCursor: number | null = null
      let pagesLoaded = 0

      while (pagesLoaded < pagesToReload) {
        const res = await listComments(docId, {
          includeResolved,
          ...(cursor == null ? {} : { cursor }),
          limit: PAGE_SIZE,
        })
        // A newer refresh/loadMore or an authoritative reconcile owns the state now. Keep the old
        // list installed until every requested page has arrived so a recovery is atomic.
        if (reqRef.current !== token || dataEpoch.current !== startEpoch) return
        for (const item of res.items) {
          if (seen.has(item.id)) continue
          seen.add(item.id)
          items.push(item)
        }
        pagesLoaded++
        nextCursor = res.nextCursor
        if (nextCursor == null) break
        cursor = nextCursor
      }

      if (reqRef.current !== token || dataEpoch.current !== startEpoch) return
      setThreads(items)
      setNextCursor(nextCursor)
      // The extra tail probe is transient recovery coverage, not user-requested pagination. Only
      // loadMore may increase the durable depth; otherwise every focus/reconnect would add another
      // permanent page and refresh cost would grow without bound. A shortened server result may
      // reduce the depth, but a successful probe never raises it.
      // Commit list, cursor and pagination metadata as one successful scope transition. A failed
      // request reaches none of these writes and therefore preserves the old installed window.
      paginationScopeRef.current = scope
      loadedPageCountRef.current = Math.max(1, Math.min(loadedDepth, pagesLoaded))
      displayedPageCountRef.current = Math.max(1, pagesLoaded)
      hasLoadedScopeRef.current = true
      dataEpoch.current++
    } catch {
      if (reqRef.current !== token) return
      setError('Failed to load comments.')
    } finally {
      if (reqRef.current === token) setLoading(false)
    }
  }, [docId, includeResolved])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const loadThread = useCallback(async (id: number): Promise<boolean | null> => {
    const token = ++nextThreadReqRef.current
    activeThreadReqRef.current.set(id, token)
    const startEpoch = dataEpoch.current
    setLoadingThreadIds((current) => new Set(current).add(id))
    try {
      const thread = await getCommentThread(docId, id)
      if (activeThreadReqRef.current.get(id) !== token || dataEpoch.current !== startEpoch) return null
      if (!includeResolved && thread.resolvedAt) return false
      setThreads((prev) => {
        const index = prev.findIndex((item) => item.id === thread.id)
        if (index < 0) return [...prev, thread].sort((a, b) => a.id - b.id)
        const next = [...prev]
        next[index] = thread
        return next
      })
      return true
    } catch {
      if (activeThreadReqRef.current.get(id) !== token || dataEpoch.current !== startEpoch) return null
      setError('Failed to load comment thread.')
      return false
    } finally {
      if (activeThreadReqRef.current.get(id) === token) {
        activeThreadReqRef.current.delete(id)
        setLoadingThreadIds((current) => {
          const next = new Set(current)
          next.delete(id)
          return next
        })
      }
    }
  }, [docId, includeResolved])

  const loadMore = useCallback(async () => {
    if (nextCursor == null || loading) return
    const token = ++reqRef.current
    const startEpoch = dataEpoch.current
    setLoading(true)
    try {
      const res = await listComments(docId, { includeResolved, cursor: nextCursor, limit: PAGE_SIZE })
      // Superseded by a newer load, or invalidated by an authoritative reconcile that
      // landed while this page was in flight — appending it now would re-introduce a
      // row reconcile just dropped (the phantom-row race), so discard it.
      if (reqRef.current !== token || dataEpoch.current !== startEpoch) return
      // This page is now newer than any reconcile that started before it completed. Invalidate
      // those non-loading-bearing reads without touching reqRef: loadMore still owns that token and
      // must reach its finally to clear the spinner.
      reconcileRef.current++
      setThreads((prev) => {
        const ids = new Set(prev.map((item) => item.id))
        return [...prev, ...res.items.filter((item) => !ids.has(item.id))]
      })
      setNextCursor(res.nextCursor)
      loadedPageCountRef.current++
      displayedPageCountRef.current++
    } catch {
      if (reqRef.current !== token) return
      setError('Failed to load more comments.')
    } finally {
      if (reqRef.current === token) setLoading(false)
    }
  }, [docId, includeResolved, nextCursor, loading])

  // Best-effort re-read of the authoritative list that leaves the error banner
  // untouched (the caller owns the message). Used to reconcile the UI after a
  // mutation is *rejected*: some rejections mean the server state already moved
  // (e.g. deleting a comment the backend had already soft-deleted returns 404),
  // so without re-reading the stale row lingers on screen — the "deleted but
  // still visible" bug.
  //
  // reconcile carries TWO guards, and NEITHER touches `loading`:
  //   1. reconcileRef (its own token, bumped) — so a newer reconcile wins over
  //      an older one.
  //   2. reqRef (the shared load token, read-only *snapshot*, never bumped here) — so
  //      a refresh/loadMore that starts after this reconcile wins. A loadMore already in flight
  //      shares the snapshot, so its successful apply separately bumps reconcileRef and wins when
  //      it completes first. reconcile bails instead of clobbering either fresher result.
  // Reading reqRef without bumping it is what lets reconcile guard against a
  // newer load (guard #2) while still leaving that load's loading-bearing token
  // intact, so its `finally { setLoading(false) }` still fires (no strand).
  //
  // On the apply path reconcile ALSO bumps dataEpoch: guard #2 only catches loads
  // that outlived the reconcile's own token snapshot, but a loadMore already
  // in flight when reconcile started shares that snapshot and would still pass
  // guard #2 on completion — appending its now-stale page (which may still carry a
  // row reconcile just removed). Bumping dataEpoch after setThreads makes such an
  // in-flight load drop its result on the freshness check. The bump is AFTER
  // setThreads so reconcile does not self-invalidate.
  const reconcile = useCallback(async () => {
    const token = ++reconcileRef.current
    const reqToken = reqRef.current
    const scope = `${docId}:${includeResolved}`
    const scopeChanged = paginationScopeRef.current !== scope
    const pagesToReload = Math.max(1, displayedPageCountRef.current)
    try {
      const items: CommentThread[] = []
      const seen = new Set<number>()
      let cursor: number | undefined
      let nextCursor: number | null = null
      let pagesLoaded = 0

      while (pagesLoaded < pagesToReload) {
        const res = await listComments(docId, {
          includeResolved,
          ...(cursor == null ? {} : { cursor }),
          limit: PAGE_SIZE,
        })
        // Superseded by a newer reconcile, or preempted by a refresh/loadMore. Keep the old list
        // intact until the full user-loaded depth has arrived so a failed mutation cannot collapse
        // an expanded drawer or install a mixed old/new pagination window.
        if (reconcileRef.current !== token || reqRef.current !== reqToken) return
        for (const item of res.items) {
          if (seen.has(item.id)) continue
          seen.add(item.id)
          items.push(item)
        }
        pagesLoaded++
        nextCursor = res.nextCursor
        if (nextCursor == null) break
        cursor = nextCursor
      }

      if (reconcileRef.current !== token || reqRef.current !== reqToken) return
      setThreads(items)
      setNextCursor(nextCursor)
      paginationScopeRef.current = scope
      displayedPageCountRef.current = Math.max(1, pagesLoaded)
      loadedPageCountRef.current = scopeChanged
        ? 1
        : Math.max(1, Math.min(loadedPageCountRef.current, displayedPageCountRef.current))
      hasLoadedScopeRef.current = true
      dataEpoch.current++ // authoritative truth installed: invalidate in-flight loads
    } catch {
      // Swallow: retain the prior list/cursor/depth and keep the caller's mutation failure message.
    }
  }, [docId, includeResolved])

  // Wrap a mutating action so callers can distinguish success from failure. On success
  // we re-read from the authoritative backend. On failure we ALSO re-read: the backend
  // is authoritative, so reconcile the list to server truth before showing the error
  // (otherwise a delete the server already applied leaves the row on screen). Returning
  // an explicit result is load-bearing: composers must retain their draft/editing state
  // when a 403 or network failure rejects the mutation.
  const runMutation = useCallback(
    async (fn: () => Promise<unknown>, action: CommentAction): Promise<CommentMutationResult> => {
      setError(null)
      try {
        await fn()
        await refresh()
        return { ok: true, error: null }
      } catch (cause) {
        await reconcile()
        const failMsg = mutationErrorMessage(action, cause)
        setError(failMsg)
        const apiError = cause instanceof CommentApiError ? cause : null
        return {
          ok: false,
          error: failMsg,
          ...(apiError?.status != null ? { status: apiError.status } : {}),
          ...(apiError?.code ? { code: apiError.code } : {}),
        }
      }
    },
    [refresh, reconcile],
  )

  const createRoot = useCallback(
    (input: CreateRootInput) =>
      runMutation(() => createRootComment(docId, input), 'add'),
    [docId, runMutation],
  )

  const reply = useCallback(
    (parentId: number, body: string) =>
      runMutation(() => createReply(docId, parentId, body), 'reply'),
    [docId, runMutation],
  )

  const editBody = useCallback(
    (id: number, body: string) =>
      runMutation(() => editCommentBody(docId, id, body), 'edit'),
    [docId, runMutation],
  )

  const resolve = useCallback(
    (id: number, resolved: boolean) =>
      runMutation(
        () => setCommentResolved(docId, id, resolved),
        resolved ? 'resolve' : 'reopen',
      ),
    [docId, runMutation],
  )

  const remove = useCallback(
    (id: number, hard: boolean) =>
      runMutation(() => deleteComment(docId, id, hard), 'delete'),
    [docId, runMutation],
  )

  // Background poll for comments other people (and Bots) added.
  //
  // WHY THIS EXISTS: comments have no realtime channel. The body is a CRDT over the hocuspocus
  // socket, but comments are a plain REST list loaded on mount and re-read after a LOCAL mutation.
  // The executable-comment flow is entirely asynchronous — you @Bot, the event queues, the agent
  // works, and it POSTs its answer seconds to minutes later. Nothing on the page hears about that.
  // So the Bot would edit the document, post its reply, and the author would still be staring at a
  // thread with no answer until they manually toggled the panel shut and open again. Indistinguishable
  // from "the Bot never replied", which is exactly how it got reported.
  //
  // Polls `reconcile`, not `refresh`: refresh sets `loading`, which would flash the panel spinner
  // every interval. reconcile is the silent re-read, and it already carries both stale-guards so it
  // can never clobber a fresher load.
  const pollSkipRef = useRef({ loading: false, extended: false })
  pollSkipRef.current = {
    loading,
    // The reader has paginated past the first page. reconcile re-reads only page 1, so polling here
    // would collapse the list and yank them back to the top. Being a few seconds late on a new
    // comment is strictly better than that; polling resumes once they scroll back.
    extended: threads.length > PAGE_SIZE,
  }
  useEffect(() => {
    if (typeof window === 'undefined') return
    const tick = () => {
      // Nobody is looking at a background tab — don't spend the request.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (pollSkipRef.current.loading || pollSkipRef.current.extended) return
      void reconcile()
    }
    const timer = window.setInterval(tick, COMMENT_POLL_INTERVAL_MS)
    // Coming back to the tab is the moment stale content is most likely AND most visible, so catch
    // up immediately instead of waiting out a full interval.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reconcile])

  return {
    threads,
    loading,
    loadingThreadIds,
    error,
    nextCursor,
    includeResolved,
    setIncludeResolved,
    refresh,
    loadMore,
    loadThread,
    createRoot,
    reply,
    editBody,
    resolve,
    remove,
  }
}

/**
 * Recover stateless board-comment invalidations missed while disconnected or backgrounded.
 * Refresh only while the drawer is open; a closed drawer already refreshes on its next open edge.
 * The existing panel instance stays mounted, preserving selected-thread, draft, and scroll state.
 */
export function useRefreshBoardComments(
  comments: UseDocComments,
  open: boolean,
  connected: boolean,
): void {
  const refreshRef = useRef(comments.refresh)
  refreshRef.current = comments.refresh
  const openRef = useRef(open)
  openRef.current = open
  const errorRef = useRef(comments.error)
  errorRef.current = comments.error
  const hasConnected = useRef(connected)
  const disconnectedAfterConnect = useRef(false)

  useEffect(() => {
    if (!connected) {
      if (hasConnected.current) disconnectedAfterConnect.current = true
      return
    }
    if (!hasConnected.current) {
      // The mount refresh normally owns first connection. If that load failed while offline, the
      // first successful connection must retry or the open drawer remains empty indefinitely.
      hasConnected.current = true
      if (open && errorRef.current) void refreshRef.current()
      return
    }
    if (open && disconnectedAfterConnect.current) void refreshRef.current()
    disconnectedAfterConnect.current = false
  }, [open, connected])

  useEffect(() => {
    const onFocus = () => {
      if (openRef.current && document.visibilityState !== 'hidden') void refreshRef.current()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}

// Re-read comments the moment the panel goes from closed → open (XIN-1323). Comments live in a
// mount-only REST hook with no realtime push, so a session-long open panel — or one reopened after
// someone else added a comment — would otherwise keep showing stale threads. Both the docs
// CommentPanel and the sheet SheetCommentPanel are driven off their shell's drawer state and share a
// single useDocComments instance, so wiring this one hook into each shell covers both from one place.
//
// We refresh only on the false → true edge (not on every render, not when the panel is already open),
// so opening once triggers at most one fetch. A direct marker hydration suppresses this full-list
// refresh to avoid a guaranteed stale request/retry pair. `refresh` is read through a ref so its
// identity changing (docId / includeResolved) never re-fires this effect —
// those already have their own refresh in useDocComments — and we avoid a stale-closure over it.
export function useRefreshCommentsOnOpen(
  comments: UseDocComments,
  open: boolean,
  directThreadHydrationPending = false,
): void {
  const refreshRef = useRef(comments.refresh)
  const skipRefreshRef = useRef(directThreadHydrationPending)
  refreshRef.current = comments.refresh
  skipRefreshRef.current = directThreadHydrationPending
  // Seed with the initial `open` so a panel that starts open doesn't double-fetch on top of the
  // hook's own mount-time load; only a genuine closed → open transition triggers a refresh.
  const prevOpen = useRef(open)
  useEffect(() => {
    if (open && !prevOpen.current && !skipRefreshRef.current) void refreshRef.current()
    prevOpen.current = open
  }, [open])
}
