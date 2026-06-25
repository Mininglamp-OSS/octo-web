// Version history REST (feature #4 §7, backend doc_version contract v0.4).
//
// All calls go through WKApp.apiClient with BARE-RELATIVE `/docs/...` paths, inheriting the
// `/api/v1/` baseURL -> `/api/v1/docs/...`. The global interceptor injects the octo `token`
// header; no auth code here. The backend role-gates every endpoint; the client still gates
// the UI by role (reader/writer/admin) so disabled affordances never reach the wire.

import { apiClient, type ApiError } from '../octoweb/index.ts'
import type { PMNode } from './diff.ts'

/**
 * Version kind as a string union for the UI. The backend stores `kind` as a small int
 * (1=auto, 2=named, 3=restore-marker); the client maps it at the boundary so the rest of
 * the frontend never deals with the magic numbers.
 */
export type VersionKind = 'auto' | 'named' | 'restore-marker'

const KIND_BY_CODE: Record<number, VersionKind> = {
  1: 'auto',
  2: 'named',
  3: 'restore-marker',
}

export interface VersionMeta {
  docVersionSeq: number
  kind: VersionKind
  label: string
  createdBy: string
  /** ISO timestamp. */
  createdAt: string
  sizeBytes: number
  schemaVersion: number
  /** For restore-marker rows: the seq this version was restored from (else null). */
  restoredFrom: number | null
}

/**
 * Full per-kind counts for the document's history (NOT affected by limit/cursor). The
 * manual stream returns named + restore rows, so the panel's "Manual versions" header count
 * is `manual + restore`; "Auto snapshots" is `auto`.
 */
export interface VersionCounts {
  auto: number
  manual: number
  restore: number
  total: number
}

export interface ListVersionsResult {
  items: VersionMeta[]
  /** docVersionSeq to pass as the next `cursor`, or null when the history is exhausted. */
  nextCursor: number | null
  /** Full history counts per kind (every list response embeds them); absent on legacy payloads. */
  counts?: VersionCounts
}

export interface RestoreResult {
  newDocVersionSeq: number
  restoredFrom: number
}

/** 409 version_schema_incompatible — saved under a format this build can't read. */
export class VersionSchemaIncompatibleError extends Error {
  constructor() {
    super('version_schema_incompatible')
    this.name = 'VersionSchemaIncompatibleError'
  }
}

/** 409 version_schema_newer — saved by a newer build than this client/server understands. */
export class VersionSchemaNewerError extends Error {
  constructor() {
    super('version_schema_newer')
    this.name = 'VersionSchemaNewerError'
  }
}

// Wire shape of a version row: `kind` arrives numeric, everything else matches VersionMeta.
interface WireVersionMeta extends Omit<VersionMeta, 'kind'> {
  kind: number
}

function mapKind(code: number): VersionKind {
  return KIND_BY_CODE[code] ?? 'auto'
}

function mapVersion(w: WireVersionMeta): VersionMeta {
  return { ...w, kind: mapKind(w.kind) }
}

export interface ListVersionsOptions {
  /** Page anchor: return rows with docVersionSeq < cursor (reverse-chronological). */
  cursor?: number | null
  limit?: number
  /**
   * Which stream to page over (each has its own cursor stream on the backend):
   *   'manual' — named + restore rows (the legacy default).
   *   'auto'   — auto snapshots only.
   *   'all'    — merged (legacy includeAuto=true).
   * Omitted → the backend defaults to 'manual'; callers that page a specific group
   * pass it explicitly so the request is self-describing.
   */
  kind?: 'manual' | 'auto' | 'all'
  signal?: AbortSignal
}

/** GET /docs/:docId/versions — reverse-chronological, cursor-paginated (reader+). */
export async function listVersions(
  docId: string,
  opts: ListVersionsOptions = {},
): Promise<ListVersionsResult> {
  const params = new URLSearchParams()
  if (opts.cursor != null) params.set('cursor', String(opts.cursor))
  if (opts.limit != null) params.set('limit', String(opts.limit))
  if (opts.kind != null) params.set('kind', opts.kind)
  const qs = params.toString()
  const url = qs ? `/docs/${docId}/versions?${qs}` : `/docs/${docId}/versions`
  const { data } = await apiClient().get<{
    items: WireVersionMeta[]
    nextCursor: number | null
    counts?: VersionCounts
  }>(url, { signal: opts.signal })
  return {
    items: (data.items ?? []).map(mapVersion),
    nextCursor: data.nextCursor ?? null,
    counts: data.counts,
  }
}

/**
 * POST /docs/:docId/versions — capture a named snapshot of the current authoritative
 * state (writer+). `label` is optional; the backend assigns the next docVersionSeq.
 */
export async function createNamedVersion(docId: string, label?: string): Promise<number> {
  const body = label != null && label.trim() !== '' ? { label: label.trim() } : {}
  const { data } = await apiClient().post<{ docVersionSeq: number }>(
    `/docs/${docId}/versions`,
    body,
  )
  return data.docVersionSeq
}

/**
 * Decoded ProseMirror-JSON document for a historical version, plus its schema metadata.
 * `doc` is the PM-JSON the preview/diff renders directly (no client-side Yjs decode).
 */
export interface VersionStateResult {
  doc: PMNode
  schemaVersion: number
  docVersionSeq: number
}

/**
 * GET /docs/:docId/versions/:seq/state — decoded ProseMirror-JSON document for client-side
 * preview/diff (reader+).
 *
 * BREAKING CONTRACT CHANGE (方案 B): this endpoint previously returned a raw octet-stream Yjs
 * state blob (responseType:'arraybuffer'); it now returns JSON `{ doc, schemaVersion,
 * docVersionSeq }`. Frontend and backend MUST deploy together — an old client against the new
 * backend (or vice versa) cannot read the response. Maps the two 409 schema codes to the same
 * typed errors as restoreVersion so the UI can show a clear, distinct message. Keeps `signal`.
 */
export async function getVersionState(
  docId: string,
  docVersionSeq: number,
  signal?: AbortSignal,
): Promise<VersionStateResult> {
  try {
    const { data } = await apiClient().get<VersionStateResult>(
      `/docs/${docId}/versions/${docVersionSeq}/state`,
      { signal },
    )
    return data
  } catch (e) {
    const err = e as ApiError<{ error?: string }>
    if (err.response?.status === 409) {
      const code = err.response.data?.error
      if (code === 'version_schema_incompatible') throw new VersionSchemaIncompatibleError()
      if (code === 'version_schema_newer') throw new VersionSchemaNewerError()
    }
    throw e
  }
}

/**
 * POST /docs/:docId/versions/:seq/restore — ADMIN/owner only. Forward, non-destructive:
 * the backend auto-saves current state, then reconciles in place (the live doc updates via
 * normal Yjs sync — no client-side doc mutation). Maps the two 409 schema codes to typed
 * errors so the UI can show a clear, distinct message.
 */
export async function restoreVersion(docId: string, docVersionSeq: number): Promise<RestoreResult> {
  try {
    const { data } = await apiClient().post<RestoreResult>(
      `/docs/${docId}/versions/${docVersionSeq}/restore`,
    )
    return data
  } catch (e) {
    const err = e as ApiError<{ error?: string }>
    if (err.response?.status === 409) {
      const code = err.response.data?.error
      if (code === 'version_schema_incompatible') throw new VersionSchemaIncompatibleError()
      if (code === 'version_schema_newer') throw new VersionSchemaNewerError()
    }
    throw e
  }
}

/** PATCH /docs/:docId/versions/:seq — rename a named version (writer+). */
export async function renameVersion(
  docId: string,
  docVersionSeq: number,
  label: string,
): Promise<void> {
  await apiClient().patch(`/docs/${docId}/versions/${docVersionSeq}`, { label })
}

/** DELETE /docs/:docId/versions/:seq — delete a historical version row (admin only). */
export async function deleteVersion(docId: string, docVersionSeq: number): Promise<void> {
  await apiClient().delete(`/docs/${docId}/versions/${docVersionSeq}`)
}
