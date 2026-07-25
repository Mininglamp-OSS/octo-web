// Comment data hook (feature #3 §).
//
// Owns the comment thread list for a doc (the single source of truth that both the panel and the
// highlight decoration layer read). Loads roots-with-replies over REST, paginates by cursor, toggles
// resolved visibility, and exposes the mutating actions (create/reply/edit/resolve/delete) which all
// refresh from the server afterwards — the backend is authoritative, so we re-read rather than guess.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listComments,
  createRootComment,
  createReply,
  editCommentBody,
  setCommentResolved,
  deleteComment,
  type CommentThread,
  type CreateRootInput,
} from './api.ts'

const PAGE_SIZE = 25

export interface UseDocComments {
  threads: CommentThread[]
  loading: boolean
  error: string | null
  nextCursor: number | null
  includeResolved: boolean
  setIncludeResolved: (v: boolean) => void
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
  createRoot: (input: CreateRootInput) => Promise<void>
  reply: (parentId: number, body: string) => Promise<void>
  editBody: (id: number, body: string) => Promise<void>
  resolve: (id: number, resolved: boolean) => Promise<void>
  remove: (id: number, hard: boolean) => Promise<void>
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

  const refresh = useCallback(async () => {
    const token = ++reqRef.current
    const startEpoch = dataEpoch.current
    setLoading(true)
    setError(null)
    try {
      const res = await listComments(docId, { includeResolved, limit: PAGE_SIZE })
      // Superseded by a newer load, or invalidated by an authoritative reconcile that
      // landed while this GET was in flight — either way don't apply this (stale) page.
      if (reqRef.current !== token || dataEpoch.current !== startEpoch) return
      setThreads(res.items)
      setNextCursor(res.nextCursor)
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
      setThreads((prev) => [...prev, ...res.items])
      setNextCursor(res.nextCursor)
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
  //   2. reqRef (the shared load token, read-only *snapshot*, never bumped) — so
  //      a refresh/loadMore that started or completed while this GET was in
  //      flight wins. reconcile bails before setThreads instead of clobbering
  //      that fresher result with its own stale snapshot.
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
    try {
      const res = await listComments(docId, { includeResolved, limit: PAGE_SIZE })
      // Superseded by a newer reconcile, or preempted by a newer refresh/loadMore
      // (which already holds fresher data) — either way, don't overwrite.
      if (reconcileRef.current !== token || reqRef.current !== reqToken) return
      setThreads(res.items)
      setNextCursor(res.nextCursor)
      dataEpoch.current++ // authoritative truth installed: invalidate in-flight loads
    } catch {
      // Swallow: keep whatever failure message the caller is about to set.
    }
  }, [docId, includeResolved])

  // Wrap a mutating action so a failed API call surfaces as a panel error instead of
  // an unhandled rejection (the handlers only had `finally`, not `catch`). On success
  // we re-read from the authoritative backend. On failure we ALSO re-read: the backend
  // is authoritative, so reconcile the list to server truth before showing the error
  // (otherwise a delete the server already applied leaves the row on screen).
  const runMutation = useCallback(
    async (fn: () => Promise<unknown>, failMsg: string): Promise<void> => {
      setError(null)
      try {
        await fn()
        await refresh()
      } catch {
        await reconcile()
        setError(failMsg)
      }
    },
    [refresh, reconcile],
  )

  const createRoot = useCallback(
    (input: CreateRootInput) =>
      runMutation(() => createRootComment(docId, input), 'Failed to add comment.'),
    [docId, runMutation],
  )

  const reply = useCallback(
    (parentId: number, body: string) =>
      runMutation(() => createReply(docId, parentId, body), 'Failed to post reply.'),
    [docId, runMutation],
  )

  const editBody = useCallback(
    (id: number, body: string) =>
      runMutation(() => editCommentBody(docId, id, body), 'Failed to save edit.'),
    [docId, runMutation],
  )

  const resolve = useCallback(
    (id: number, resolved: boolean) =>
      runMutation(
        () => setCommentResolved(docId, id, resolved),
        resolved ? 'Failed to resolve comment.' : 'Failed to reopen comment.',
      ),
    [docId, runMutation],
  )

  const remove = useCallback(
    (id: number, hard: boolean) =>
      runMutation(() => deleteComment(docId, id, hard), 'Failed to delete comment.'),
    [docId, runMutation],
  )

  return {
    threads,
    loading,
    error,
    nextCursor,
    includeResolved,
    setIncludeResolved,
    refresh,
    loadMore,
    createRoot,
    reply,
    editBody,
    resolve,
    remove,
  }
}

// Re-read comments the moment the panel goes from closed → open (XIN-1323). Comments live in a
// mount-only REST hook with no realtime push, so a session-long open panel — or one reopened after
// someone else added a comment — would otherwise keep showing stale threads. Both the docs
// CommentPanel and the sheet SheetCommentPanel are driven off their shell's drawer state and share a
// single useDocComments instance, so wiring this one hook into each shell covers both from one place.
//
// We refresh only on the false → true edge (not on every render, not when the panel is already open),
// so opening once triggers exactly one fetch and no duplicate concurrent loads. `refresh` is read
// through a ref so its identity changing (docId / includeResolved) never re-fires this effect —
// those already have their own refresh in useDocComments — and we avoid a stale-closure over it.
export function useRefreshCommentsOnOpen(comments: UseDocComments, open: boolean): void {
  const refreshRef = useRef(comments.refresh)
  refreshRef.current = comments.refresh
  // Seed with the initial `open` so a panel that starts open doesn't double-fetch on top of the
  // hook's own mount-time load; only a genuine closed → open transition triggers a refresh.
  const prevOpen = useRef(open)
  useEffect(() => {
    if (open && !prevOpen.current) void refreshRef.current()
    prevOpen.current = open
  }, [open])
}
