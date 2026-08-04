// Inline-comment REST (feature #3 §, backend PR #5 frozen contract).
//
// Comments do NOT live in the Y.Doc — they are an independent table reached over REST.
// Only the ANCHOR is a Yjs RelativePosition (see anchor.ts) so a comment survives concurrent
// edits. All calls go through WKApp.apiClient with BARE-RELATIVE `/docs/...` paths, inheriting
// the `/api/v1/` baseURL -> `/api/v1/docs/...`; the global interceptor injects the octo token
// header (no auth code here, mirrors members/api.ts). Backend is the real permission authority —
// frontend role gating (roles.ts) is UX only.

import { apiClient, type ApiError } from '../octoweb/index.ts'

export class CommentApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly code: string | undefined,
    cause?: unknown,
  ) {
    super(message)
    this.name = 'CommentApiError'
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause
  }
}

/** Keep the server classification when crossing the comment API boundary. */
async function commentRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (cause) {
    const error = cause as ApiError<{ error?: string; code?: string }> & {
      code?: string
      message?: string
    }
    const status = error.response?.status
    const code = error.response?.data?.code ?? error.response?.data?.error ?? error.code
    throw new CommentApiError(error.message ?? 'Comment request failed', status, code, cause)
  }
}

/** Wire shape of a single comment (frozen backend contract). */
export interface Comment {
  id: number
  docId: string
  parentId: number | null
  authorUid: string
  body: string
  /** base64-encoded Yjs RelativePosition; null on replies / orphaned roots. */
  anchorStart: string | null
  anchorEnd: string | null
  /** Plain-text snapshot of the anchored range at create time (orphan fallback). */
  anchorText: string
  resolved: boolean
  resolvedBy: string | null
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

export interface CommentMarker {
  id: number
  anchorStart: string
  anchorText: string
  updatedAt: string
}

export interface ListCommentMarkersResult {
  items: CommentMarker[]
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
export async function getCommentThread(docId: string, id: number): Promise<CommentThread> {
  const { data } = await commentRequest(() => apiClient().get<CommentThread>(`/docs/${docId}/comments/${id}/thread`))
  return data
}

export async function listComments(
  docId: string,
  opts: ListCommentsOptions = {},
): Promise<ListCommentsResult> {
  const params = new URLSearchParams()
  if (opts.includeResolved) params.set('includeResolved', '1')
  if (opts.cursor != null) params.set('cursor', String(opts.cursor))
  if (opts.limit != null) params.set('limit', String(opts.limit))
  const qs = params.toString()
  const { data } = await commentRequest(() => apiClient().get<ListCommentsResult>(
    `/docs/${docId}/comments${qs ? `?${qs}` : ''}`,
  ))
  return { items: data.items ?? [], nextCursor: data.nextCursor ?? null }
}

export interface CreateRootInput {
  body: string
  /** base64 Yjs RelativePosition (required for a root). */
  anchorStart: string
  anchorEnd: string
  anchorText?: string
}

/** Lightweight unresolved-root listing used by board markers. */
export async function listCommentMarkers(
  docId: string,
  cursor?: number,
  limit = 100,
): Promise<ListCommentMarkersResult> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor != null) params.set('cursor', String(cursor))
  const { data } = await commentRequest(() => apiClient().get<ListCommentMarkersResult>(
    `/docs/${docId}/comments/markers?${params.toString()}`,
  ))
  return { items: data.items ?? [], nextCursor: data.nextCursor ?? null }
}


/** Marker endpoint is optional during rolling frontend/backend deploys. Only endpoint-contract
 * absence/conflict degrades to the detailed thread feed; auth and transport failures stay visible. */
export function isUnavailableMarkerEndpoint(error: unknown): boolean {
  const status = error instanceof CommentApiError
    ? error.status
    : (error as { response?: { status?: number } })?.response?.status
  return status === 404 || status === 409
}

/** Walk every cursor page so marker rendering covers all unresolved roots, not only the drawer page. */
export async function listAllCommentMarkers(docId: string): Promise<CommentMarker[]> {
  const MAX_MARKER_PAGES = 100
  const result: CommentMarker[] = []
  let cursor: number | undefined
  const seen = new Set<number>()
  for (let pageNumber = 0; pageNumber < MAX_MARKER_PAGES; pageNumber++) {
    const page = await listCommentMarkers(docId, cursor)
    result.push(...page.items)
    const next = page.nextCursor ?? undefined
    if (next === undefined) return result
    if (!Number.isSafeInteger(next) || next < 0 || seen.has(next) || (cursor !== undefined && next <= cursor)) {
      throw new Error('Invalid comment marker cursor')
    }
    seen.add(next)
    cursor = next
  }
  throw new Error('Comment marker pagination limit exceeded')
}

/** POST /docs/:docId/comments — ROOT (carries anchors). Returns the new comment id. */
export async function createRootComment(docId: string, input: CreateRootInput): Promise<number> {
  const { data } = await commentRequest(() => apiClient().post<{ id: number }>(`/docs/${docId}/comments`, {
    body: input.body,
    anchorStart: input.anchorStart,
    anchorEnd: input.anchorEnd,
    anchorText: input.anchorText ?? '',
  }))
  return data.id
}

/** POST /docs/:docId/comments — REPLY (no anchors; parentId must be a thread root). */
export async function createReply(
  docId: string,
  parentId: number,
  body: string,
): Promise<number> {
  const { data } = await commentRequest(() => apiClient().post<{ id: number }>(`/docs/${docId}/comments`, {
    body,
    parentId,
  }))
  return data.id
}

/** PATCH /docs/:docId/comments/:id — edit body (AUTHOR only). */
export async function editCommentBody(docId: string, id: number, body: string): Promise<void> {
  await commentRequest(() => apiClient().patch(`/docs/${docId}/comments/${id}`, { body }))
}

/** PATCH /docs/:docId/comments/:id — resolve / reopen a root (WRITER+). */
export async function setCommentResolved(
  docId: string,
  id: number,
  resolved: boolean,
): Promise<void> {
  await commentRequest(() => apiClient().patch(`/docs/${docId}/comments/${id}`, { resolved }))
}

/** DELETE /docs/:docId/comments/:id — author soft-delete, or admin hard-delete (?hard=1). */
export async function deleteComment(docId: string, id: number, hard = false): Promise<void> {
  await commentRequest(() => apiClient().delete(`/docs/${docId}/comments/${id}${hard ? '?hard=1' : ''}`))
}
