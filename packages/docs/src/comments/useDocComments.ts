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
  const reqRef = useRef(0)

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

  // Wrap a mutating action so a failed API call surfaces as a panel error instead of
  // an unhandled rejection (the handlers only had `finally`, not `catch`). On success
  // we re-read from the authoritative backend.
  const runMutation = useCallback(
    async (fn: () => Promise<unknown>, failMsg: string): Promise<void> => {
      setError(null)
      try {
        await fn()
        await refresh()
      } catch {
        setError(failMsg)
      }
    },
    [refresh],
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
