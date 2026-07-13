// Document list / create REST (backend §8.4).
//
// All calls go through WKApp.apiClient with BARE-RELATIVE `/docs/...` paths, inheriting the
// `/api/v1/` baseURL -> `/api/v1/docs/...`. The global interceptor injects the octo `token`
// header; no auth code here.

import { apiClient } from '../octoweb/index.ts'
import type { Role } from '../auth/roles.ts'

export interface DocListItem {
  docId: string
  title: string
  ownerId: string
  role: Role
  updatedAt?: string
  /**
   * Document kind: `'doc'` (Tiptap rich text, the default) or `'board'` (Excalidraw whiteboard).
   * Optional because older records and backends that predate the whiteboard feature omit it; a
   * missing value is treated as a plain document. The list mixes both kinds and distinguishes
   * them by icon (frontend-design §4.1 / §5.1).
   */
  docType?: string
}

export interface ListDocsResult {
  total: number
  items: DocListItem[]
}

export interface CreateDocResult {
  docId: string
  documentName: string
  title: string
  spaceId: string
  folderId: string
  ownerId: string
  role: Role
  /** Echoed back when the backend persists the requested `docType` (else absent). */
  docType?: string
}

export interface ListDocsParams {
  spaceId?: string
  folderId?: string
  page?: number
  pageSize?: number
  sort?: 'updatedAt:desc' | 'updatedAt:asc'
}

/** GET /api/v1/docs — list docs the caller owns or is a member of. */
export async function listDocs(params: ListDocsParams = {}): Promise<ListDocsResult> {
  const q = new URLSearchParams()
  if (params.spaceId) q.set('spaceId', params.spaceId)
  if (params.folderId) q.set('folderId', params.folderId)
  if (params.page) q.set('page', String(params.page))
  if (params.pageSize) q.set('pageSize', String(params.pageSize))
  if (params.sort) q.set('sort', params.sort)
  const qs = q.toString()
  const { data } = await apiClient().get<ListDocsResult>(`/docs${qs ? `?${qs}` : ''}`)
  return data
}

/** POST /api/v1/docs — create a new document; caller becomes admin. */
export async function createDoc(input: {
  title?: string
  spaceId?: string
  folderId?: string
  docType?: string
}): Promise<CreateDocResult> {
  const { data } = await apiClient().post<CreateDocResult>('/docs', input)
  return data
}

export interface DocMeta {
  docId: string
  title: string
  ownerId?: string
  role?: Role
  updatedAt?: string
  /**
   * Creation timestamp (RFC3339), returned by the per-doc GET. Consumed by the header "more"
   * menu to show a "Created on YYYY-MM-DD" line. Optional / forward-compatible: when the backend
   * omits it the menu simply drops the created-on row rather than showing a broken date.
   */
  createdAt?: string
  /**
   * Canonical collab document key `octo:{space}:{folder}:{doc}` (see documentName/index.ts).
   * Returned by the per-doc GET so a standalone deep-link (`/d/:docId`), which knows only the
   * docId and not the owning space/folder, can address collaboration exactly instead of guessing.
   * Optional / forward-compatible: when the backend omits it, callers fall back to the caller's
   * current space + default folder (same addressing the in-shell list uses).
   */
  documentName?: string
  /** `'doc'` | `'board'` — see DocListItem.docType. Absent on backends that don't persist it. */
  docType?: string
}

/**
 * GET /api/v1/docs/{docId} — fetch a single document's metadata (title etc).
 * Used to render the real title in the editor header instead of a hardcoded
 * placeholder. Resilient: callers fall back to a passed-in title if this throws
 * (e.g. the backend has no per-doc GET in a given environment).
 *
 * `opts.spaceId` (standalone by-space need): the backend gates `/docs/:docId` behind a by-space
 * middleware — a request with no `X-Space-Id` header is rejected (400 space_required) and a header
 * that does not match the doc's space returns 404. In-shell callers omit `opts` and rely on the
 * global request interceptor (spaceIdCallback → WKApp.shared.currentSpaceId) to inject the header.
 * The standalone `/d/:docId` page mounts before that space is restored, so the interceptor injects
 * nothing; it passes the resolved space here to carry an explicit `X-Space-Id` on the preflight,
 * which axios merges over (and thus wins against) the interceptor's absent header. A non-empty
 * `opts.spaceId` is the only trigger — omitting it preserves the exact prior no-header behavior.
 */
export async function getDoc(docId: string, opts?: { spaceId?: string }): Promise<DocMeta> {
  const config =
    opts?.spaceId ? { headers: { 'X-Space-Id': opts.spaceId } } : undefined
  const { data } = await apiClient().get<DocMeta>(`/docs/${docId}`, config)
  return data
}

/**
 * GET /api/v1/users/{uid} — resolve a uid to a human display name. Used by the header "more" menu
 * to render the document creator (the doc's ownerId) as a name instead of a raw uid. The host user
 * payload carries `name` (nickname) and, when the user is verified, `real_name`.
 *
 * By default (in-shell editor) we prefer the verified real name and fall back to the nickname.
 * Pass `{ preferRealName: false }` to force the NICKNAME only and never expose `real_name` — the
 * standalone `/d/:docId` page uses this because it is an externally shareable surface: anyone with
 * the link would otherwise see the creator's verified legal name (privacy leak, boss decision).
 *
 * Resilient by contract: it returns `undefined` when no usable name is present, so the menu can
 * fall back to a short uid / placeholder without crashing.
 */
export async function getUserName(
  uid: string,
  opts: { preferRealName?: boolean } = {},
): Promise<string | undefined> {
  const { preferRealName = true } = opts
  const { data } = await apiClient().get<{ name?: string; real_name?: string }>(`/users/${uid}`)
  const resolved = preferRealName ? data?.real_name || data?.name : data?.name
  const name = (resolved || '').trim()
  return name || undefined
}

/**
 * PATCH /api/v1/docs/{docId} — rename a document. Backend confirmed 200 + DB
 * persistence. Manage-role only (enforced server-side; UI also gates on canManage).
 */
export async function updateDocTitle(docId: string, title: string): Promise<DocMeta> {
  const { data } = await apiClient().patch<DocMeta>(`/docs/${docId}`, { title })
  return data
}

/**
 * DELETE /api/v1/docs/{docId} — delete a document (owner/admin only; enforced server-side, the
 * UI also gates the control on role). Contract (C3 final): 200 deleted; 404 already gone; 403
 * not admin; 409 archived target. Callers map the ApiError status to the right message — this
 * helper just performs the request and lets the error propagate.
 */
export async function deleteDoc(docId: string): Promise<void> {
  await apiClient().delete(`/docs/${docId}`)
}

/**
 * POST /api/v1/docs/{docId}/export/pdf — server-side (Typst) PDF render.
 * Returns the PDF bytes as an ArrayBuffer.
 *
 * Goes through the shared host apiClient with `responseType: 'arraybuffer'` so
 * the binary PDF body is not decoded as UTF-8 text (which would turn every
 * non-ASCII byte into U+FFFD and corrupt the file). Using the host client keeps
 * this on the same axios instance as the rest of the app, so the global request
 * interceptor (token + X-Space-Id) and `/api/v1/` baseURL apply — docs does not
 * depend on axios directly. A longer per-request timeout covers big documents
 * that the shared 20s default would otherwise cut off mid-success.
 */
export async function exportDocPdf(docId: string): Promise<ArrayBuffer> {
  const { data } = await apiClient().post<ArrayBuffer>(
    `/docs/${docId}/export/pdf`,
    undefined,
    { responseType: 'arraybuffer', timeout: 120_000 },
  )
  return data
}

/**
 * Delete outcome classification (contract C3 final), kept as a pure function so the 200/404/403/409
 * handling is unit-testable and shared wherever the delete entry lives:
 *   200 → 'deleted'; 404 → 'gone' (already removed — treat as success); 403 → 'forbidden';
 *   409 → 'archived'; anything else → 'failed'.
 */
export type DeleteOutcome = 'gone' | 'forbidden' | 'archived' | 'failed'

export function classifyDeleteStatus(status: number | undefined): DeleteOutcome {
  if (status === 404) return 'gone'
  if (status === 403) return 'forbidden'
  if (status === 409) return 'archived'
  return 'failed'
}

/** i18n key for a non-success delete outcome (404/'gone' is handled as success, not an error). */
export function deleteErrorKey(outcome: Exclude<DeleteOutcome, 'gone'>): string {
  switch (outcome) {
    case 'forbidden':
      return 'docs.doc.deleteForbidden'
    case 'archived':
      return 'docs.doc.deleteArchived'
    default:
      return 'docs.doc.deleteFailed'
  }
}
