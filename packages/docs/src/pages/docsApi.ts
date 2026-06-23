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
}

/**
 * GET /api/v1/docs/{docId} — fetch a single document's metadata (title etc).
 * Used to render the real title in the editor header instead of a hardcoded
 * placeholder. Resilient: callers fall back to a passed-in title if this throws
 * (e.g. the backend has no per-doc GET in a given environment).
 */
export async function getDoc(docId: string): Promise<DocMeta> {
  const { data } = await apiClient().get<DocMeta>(`/docs/${docId}`)
  return data
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
