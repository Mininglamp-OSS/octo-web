// Document list / create REST (backend §8.4).
//
// All calls go through WKApp.apiClient with BARE-RELATIVE `/docs/...` paths, inheriting the
// `/api/v1/` baseURL -> `/api/v1/docs/...`. The global interceptor injects the octo `token`
// header; no auth code here.

import { apiClient } from '../octoweb/index.ts'
import type { Role } from '../auth/roles.ts'

/**
 * Document kind enum — the wire contract for `doc_type`, authored in lockstep with the backend
 * (octo-docs-backend `DOC_TYPES` in src/db/docType.ts and the `doc_meta.doc_type` column). The three
 * values are the single source of truth on BOTH sides: the list distinguishes them by row icon and
 * the type filter narrows the recent/mine feeds on them (`?type=doc&type=sheet`). Never mock a value
 * that the backend does not persist — a drifting enum is exactly the assumed-wire trap FEAT-B avoids.
 */
export const DOC_TYPES = ['doc', 'sheet', 'board'] as const
export type DocType = (typeof DOC_TYPES)[number]

export interface DocListItem {
  docId: string
  title: string
  ownerId: string
  role: Role
  updatedAt?: string
  /**
   * Last-viewed timestamp (ISO-8601, UTC, ms). Present ONLY on "recent" (最近查看) rows — the
   * backend `GET /docs/recent` response includes it (XIN-1098 API 2); the plain `GET /docs`
   * (我的文档 / owned) response omits it. Consumed by the recent tab to order and render the
   * "viewed" sub-line; absent for "my documents" rows (frontend-design §3.2 / §3.3).
   */
  viewedAt?: string
  /**
   * Last-updater identity, resolved server-side to `{uid, name}` (XIN-1240, sourced from
   * `doc_meta.updated_by`). Present ONLY on "recent" (最近查看) rows; `null` when the document has
   * no recorded last-updater. The recent tab uses it to label the merged time line — when the doc
   * was updated after the current user last viewed it, the line reads "<name> 更新于 X" instead of
   * "你查看于 X". A missing / null value degrades to an unnamed "更新于 X" line (never guesses).
   */
  updatedBy?: { uid: string; name: string } | null
  /**
   * Document kind — one of {@link DocType}: `'doc'` (Tiptap rich text, the default), `'sheet'`
   * (Univer spreadsheet), or `'board'` (Excalidraw whiteboard). Optional because older records and
   * backends that predate a given kind omit it; a missing value is treated as a plain document. The
   * list mixes all kinds and distinguishes them by icon (frontend-design §4.1 / §5.1).
   */
  docType?: string
}

export interface ListDocsResult {
  total: number
  items: DocListItem[]
}

/** A creator candidate for the recent-tab filter — server-resolved `{uid,name}` (XIN-1098 API 4). */
export interface CreatorOption {
  uid: string
  name: string
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
  /**
   * Filename search term (frontend-design §3.3 / XIN-1098 §4.1). The server trims it and treats a
   * blank result as "no search"; a case-insensitive substring match is applied before pagination.
   */
  q?: string
  /**
   * `'me'` scopes the list to documents the caller OWNS (strict `owner_id == uid`), excluding
   * shared-to-me docs — the "我的文档" tab (frontend-design §3.3 / XIN-1098 API 3). Omitted for the
   * legacy "owned or member" listing.
   */
  owner?: 'me'
  /**
   * Selected document kinds — multi-value OR filter serialized as repeated `?type=doc&type=sheet`
   * (same repeated-param convention as `creator`, never CSV; frontend-design §5.2 / XIN-1188). The
   * server narrows on `doc_type` BEFORE pagination and treats an absent param as "no type filter",
   * so it is fully backward compatible. Empty = no type filter.
   */
  types?: DocType[]
}

/** GET /api/v1/docs — list docs the caller owns or is a member of (or, with `owner=me`, owns). */
export async function listDocs(params: ListDocsParams = {}): Promise<ListDocsResult> {
  const q = new URLSearchParams()
  if (params.spaceId) q.set('spaceId', params.spaceId)
  if (params.folderId) q.set('folderId', params.folderId)
  if (params.page) q.set('page', String(params.page))
  if (params.pageSize) q.set('pageSize', String(params.pageSize))
  if (params.sort) q.set('sort', params.sort)
  if (params.owner) q.set('owner', params.owner)
  const term = (params.q ?? '').trim()
  if (term) q.set('q', term)
  for (const ty of params.types ?? []) {
    if (ty) q.append('type', ty)
  }
  const qs = q.toString()
  const { data } = await apiClient().get<ListDocsResult>(`/docs${qs ? `?${qs}` : ''}`)
  return { total: data?.total ?? (data?.items?.length ?? 0), items: data?.items ?? [] }
}

export interface RecentDocsParams {
  /** Filename search term (server trims; blank = no search). Same normalization as `listDocs`. */
  q?: string
  /**
   * Selected creator uids — multi-value OR filter (`?creator=a&creator=b`). Only the recent tab
   * carries this (frontend-design §3.2 / XIN-1098 §4.2). Empty = no creator filter.
   */
  creators?: string[]
  /**
   * Selected document kinds — multi-value OR filter serialized as repeated `?type=doc&type=sheet`
   * (same convention as `creators`; frontend-design §5.2 / XIN-1188). Narrowed server-side on
   * `doc_type` before keyset pagination; absent param = no type filter (backward compatible).
   */
  types?: DocType[]
  /**
   * Keyset cursor for the NEXT page (opaque, from the previous response's `nextCursor`). First page
   * omits it. Recent pagination is keyset-only — there is NO offset fallback (XIN-1098 §4.3).
   */
  cursor?: string | null
  pageSize?: number
}

export interface RecentDocsResult {
  total: number
  items: DocListItem[]
  /** Opaque keyset cursor for the next page; `null`/absent means no more pages (XIN-1098 §4.3). */
  nextCursor: string | null
}

/**
 * GET /api/v1/docs/recent — the "最近查看" (recently viewed) feed, ordered `viewed_at DESC` on the
 * server (XIN-1098 API 2). Keyset-paginated: pass the previous response's `nextCursor` to page; a
 * null `nextCursor` marks the end. uid + space are derived server-side from the token / `X-Space-Id`
 * header (the frontend never sends them). Resilient: coerces a missing body to an empty page so a
 * not-yet-deployed backend degrades to an empty list rather than throwing.
 */
export async function listRecentDocs(params: RecentDocsParams = {}): Promise<RecentDocsResult> {
  const q = new URLSearchParams()
  const term = (params.q ?? '').trim()
  if (term) q.set('q', term)
  for (const uid of params.creators ?? []) {
    if (uid) q.append('creator', uid)
  }
  for (const ty of params.types ?? []) {
    if (ty) q.append('type', ty)
  }
  if (params.cursor) q.set('cursor', params.cursor)
  if (params.pageSize) q.set('pageSize', String(params.pageSize))
  const qs = q.toString()
  try {
    const { data } = await apiClient().get<Partial<RecentDocsResult>>(
      `/docs/recent${qs ? `?${qs}` : ''}`,
    )
    const items = data?.items ?? []
    return {
      total: data?.total ?? items.length,
      items,
      nextCursor: data?.nextCursor ?? null,
    }
  } catch {
    // Degrade to an empty page when the endpoint is not yet deployed (404) or errors (5xx). A
    // rejected request would otherwise bubble to useDocsView's `.catch` and flip the default tab to
    // the error phase; the contract (and the JSDoc above) is an empty list, mirroring recordDocView.
    return { total: 0, items: [], nextCursor: null }
  }
}

/**
 * GET /api/v1/docs/recent/creators — creator candidates for the recent-tab filter (XIN-1098 API 4).
 * The candidate set is "the DISTINCT owners of the current recent result set AFTER `q` filtering,
 * BEFORE creator filtering, BEFORE pagination, AFTER permission filtering". The server resolves each
 * `name`, so the dropdown needs no per-uid name round-trips. Resilient: returns `[]` on a missing /
 * malformed body so a not-yet-deployed backend just yields no candidates.
 */
export async function listRecentCreators(q?: string): Promise<CreatorOption[]> {
  const params = new URLSearchParams()
  const term = (q ?? '').trim()
  if (term) params.set('q', term)
  const qs = params.toString()
  try {
    const { data } = await apiClient().get<{ creators?: CreatorOption[] }>(
      `/docs/recent/creators${qs ? `?${qs}` : ''}`,
    )
    return Array.isArray(data?.creators) ? data.creators : []
  } catch {
    // Not-yet-deployed / erroring backend yields no candidates rather than throwing (same contract
    // as listRecentDocs); the recent tab simply shows an empty creator filter.
    return []
  }
}

/**
 * POST /api/v1/docs/{docId}/view — record that the caller opened a document (ingest, XIN-1098 API 1).
 * Fire-and-forget by contract: the caller `void`s it and this helper swallows every failure, so a
 * failed / not-yet-deployed ingest never blocks opening the doc and never surfaces a toast
 * (frontend-design §3.4). No body — uid is derived server-side. The server UPSERTs on `(uid,docId)`
 * so calling it once per open is idempotent.
 */
export async function recordDocView(docId: string): Promise<void> {
  try {
    await apiClient().post(`/docs/${encodeURIComponent(docId)}/view`)
  } catch {
    // Fire-and-forget: ingest is best-effort and must never disrupt the open path. The backend
    // collab-token path also has a best-effort fallback ingest, so a dropped call here is covered.
  }
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
  /**
   * Link share scope / role (feature #64). The per-doc GET returns these additive, optional fields
   * so the share dialog can render current state without a second GET /share round-trip. Forward-
   * compatible: a backend that predates #64 omits them, and the share section falls back to fetching
   * GET /share (or the restricted/read default). Typed loosely as string so an unexpected value is
   * normalized at the consumer (share/shareScope.ts) rather than breaking the meta parse.
   */
  shareScope?: string
  shareRole?: string
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
 * Parsed ProseMirror document + non-fatal warnings returned by the server-side
 * .docx import. `doc` is a ProseMirror `doc` JSON ready to inject via setContent;
 * `warnings` surface best-effort degradations (e.g. an image that failed to
 * upload was replaced by a file-attachment placeholder).
 */
export interface DocxImportResult {
  doc: unknown
  warnings: string[]
}

/**
 * Import a .docx file into an (already created, empty) doc. The raw file bytes
 * are POSTed to the server-side importer, which parses the OOXML to ProseMirror
 * JSON, uploads embedded images as attachments scoped to `docId`, and returns
 * the document plus any degradation warnings. The caller injects `doc` into the
 * editor. Requires editor role on `docId` (import writes content).
 *
 * Goes through the shared host apiClient so the global token / X-Space-Id
 * interceptor and `/api/v1/` baseURL apply. The docx content-type is set per
 * request; a longer timeout covers large documents with many images.
 */
export async function importDocx(docId: string, file: File): Promise<DocxImportResult> {
  const bytes = await file.arrayBuffer()
  const { data } = await apiClient().post<DocxImportResult>(
    `/docs/${docId}/import/docx`,
    bytes,
    {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      timeout: 120_000,
    },
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
