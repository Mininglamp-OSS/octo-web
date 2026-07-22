// Inline-comment REST (feature #3 §, backend PR #5 frozen contract).
//
// Comments do NOT live in the Y.Doc — they are an independent table reached over REST.
// Only the ANCHOR is a Yjs RelativePosition (see anchor.ts) so a comment survives concurrent
// edits. All calls go through WKApp.apiClient with BARE-RELATIVE `/docs/...` paths, inheriting
// the `/api/v1/` baseURL -> `/api/v1/docs/...`; the global interceptor injects the octo token
// header (no auth code here, mirrors members/api.ts). Backend is the real permission authority —
// frontend role gating (roles.ts) is UX only.

import { apiClient } from '../octoweb/index.ts'

/** Wire shape of a single comment (frozen backend contract). */
export interface Comment {
  id: number
  docId: string
  parentId: number | null
  authorUid: string
  /**
   * Display name resolved server-side from the user directory (backend PR: author
   * name enrichment). A real name for authors the space-member map misses (e.g. a
   * doc-shared / non-active / stale-cache member), so the UI must prefer this. It
   * is `null` when the directory could not resolve a name (e.g. bots, which have
   * none there) — the render then falls through to the member map (bot backfill)
   * and finally the uid. Absent on responses from an older backend.
   */
  authorName?: string | null
  body: string
  /** base64-encoded Yjs RelativePosition; null on replies / orphaned roots. */
  anchorStart: string | null
  anchorEnd: string | null
  /** Plain-text snapshot of the anchored range at create time (orphan fallback). */
  anchorText: string
  resolved: boolean
  resolvedBy: string | null
  /** Display name of the resolver, resolved server-side; falls back to the uid / absent on older backends. */
  resolvedByName?: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

/** A thread root plus its nested replies (list response groups replies under their root). */
export interface CommentThread extends Comment {
  replies: Comment[]
}

export interface ListCommentsResult {
  items: CommentThread[]
  nextCursor: number | null
}

export interface ListCommentsOptions {
  /** Include resolved roots (default: server omits them). */
  includeResolved?: boolean
  /** Paginate roots by id. */
  cursor?: number
  limit?: number
}

/** GET /docs/:docId/comments — roots only at top level, each carrying its `replies`. */
export async function listComments(
  docId: string,
  opts: ListCommentsOptions = {},
): Promise<ListCommentsResult> {
  const params = new URLSearchParams()
  if (opts.includeResolved) params.set('includeResolved', '1')
  if (opts.cursor != null) params.set('cursor', String(opts.cursor))
  if (opts.limit != null) params.set('limit', String(opts.limit))
  const qs = params.toString()
  const { data } = await apiClient().get<ListCommentsResult>(
    `/docs/${docId}/comments${qs ? `?${qs}` : ''}`,
  )
  return { items: data.items ?? [], nextCursor: data.nextCursor ?? null }
}

export interface CreateRootInput {
  body: string
  /** base64 Yjs RelativePosition (required for a root). */
  anchorStart: string
  anchorEnd: string
  anchorText?: string
}

/** POST /docs/:docId/comments — ROOT (carries anchors). Returns the new comment id. */
export async function createRootComment(docId: string, input: CreateRootInput): Promise<number> {
  const { data } = await apiClient().post<{ id: number }>(`/docs/${docId}/comments`, {
    body: input.body,
    anchorStart: input.anchorStart,
    anchorEnd: input.anchorEnd,
    anchorText: input.anchorText ?? '',
  })
  return data.id
}

/** POST /docs/:docId/comments — REPLY (no anchors; parentId must be a thread root). */
export async function createReply(
  docId: string,
  parentId: number,
  body: string,
): Promise<number> {
  const { data } = await apiClient().post<{ id: number }>(`/docs/${docId}/comments`, {
    body,
    parentId,
  })
  return data.id
}

/** PATCH /docs/:docId/comments/:id — edit body (AUTHOR only). */
export async function editCommentBody(docId: string, id: number, body: string): Promise<void> {
  await apiClient().patch(`/docs/${docId}/comments/${id}`, { body })
}

/** PATCH /docs/:docId/comments/:id — resolve / reopen a root (WRITER+). */
export async function setCommentResolved(
  docId: string,
  id: number,
  resolved: boolean,
): Promise<void> {
  await apiClient().patch(`/docs/${docId}/comments/${id}`, { resolved })
}

/** DELETE /docs/:docId/comments/:id — author soft-delete, or admin hard-delete (?hard=1). */
export async function deleteComment(docId: string, id: number, hard = false): Promise<void> {
  await apiClient().delete(`/docs/${docId}/comments/${id}${hard ? '?hard=1' : ''}`)
}
