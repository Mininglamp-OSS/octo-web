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

  const refresh = useCallback(async () => {
    const token = ++reqRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await listComments(docId, { includeResolved, limit: PAGE_SIZE })
      if (reqRef.current !== token) return // superseded by a newer load
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
    setLoading(true)
    try {
      const res = await listComments(docId, { includeResolved, cursor: nextCursor, limit: PAGE_SIZE })
      if (reqRef.current !== token) return // superseded
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
