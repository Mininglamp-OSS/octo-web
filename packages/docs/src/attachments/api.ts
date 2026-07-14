// Attachment upload/read REST (backend §8.x, SCHEMA-SPEC §2 `image` node).
//
// Mirrors src/members/api.ts: all docs REST goes through WKApp.apiClient with
// BARE-RELATIVE `/docs/...` paths (inheriting the `/api/v1/` baseURL -> `/api/v1/docs/...`).
// The global interceptor injects the octo `token` header; no auth code here.
//
// The presigned object-storage PUT is the ONE deliberate exception: `uploadUrl` is
// an absolute, cross-origin storage URL, so the raw bytes go out with a plain fetch
// (NOT apiClient) and carry NO octo token — only the headers the presign response
// dictates, plus Content-Type = mime.

import { apiClient, type ApiError } from '../octoweb/index.ts'

export interface PresignRequest {
  fileName: string
  mime: string
  sizeBytes: number
}

export interface PresignResult {
  attachId: string
  objectKey: string
  bucket: string
  mime: string
  sizeBytes: number
  /** Absolute, presigned, cross-origin object-storage URL — PUT the bytes here. */
  uploadUrl: string
  /** Headers the storage PUT must echo (signature components, etc.). */
  headers: Record<string, string>
  expiresInSec: number
}

export interface ReadResult {
  attachId: string
  objectKey: string
  mime: string
  sizeBytes: number
  /** Freshly signed, time-limited GET URL for display — use as the <img src>. */
  url: string
  expiresInSec: number
}

/**
 * Marker error so the UI can surface a backend presign rejection (400) verbatim:
 * `mime_not_allowed` | `mime_blocked` | `size_too_large` | "fileName required" |
 * "sizeBytes must be a positive number". The backend is the final authority; the
 * frontend pre-checks only to avoid obviously-doomed round trips.
 */
export class AttachmentRejectedError extends Error {
  constructor(public readonly reason: string) {
    super(reason)
    this.name = 'AttachmentRejectedError'
  }
}

/** POST /docs/{docId}/attachments/presign (needs writer). 400 -> AttachmentRejectedError. */
export async function presignUpload(docId: string, req: PresignRequest): Promise<PresignResult> {
  try {
    const { data } = await apiClient().post<PresignResult>(
      `/docs/${docId}/attachments/presign`,
      req,
    )
    return data
  } catch (e) {
    const err = e as ApiError<{ error?: string }>
    if (err.response?.status === 400) {
      throw new AttachmentRejectedError(err.response.data?.error ?? 'invalid_request')
    }
    throw e
  }
}

/**
 * PUT the raw bytes to the presigned storage URL. Cross-origin to object storage, so
 * this bypasses apiClient (no octo token) and applies only the presign `headers`,
 * with Content-Type forced to the negotiated mime.
 */
export async function uploadBinary(presign: PresignResult, file: Blob): Promise<void> {
  const headers: Record<string, string> = {
    ...(presign.headers ?? {}),
    'Content-Type': presign.mime,
  }
  const res = await fetch(presign.uploadUrl, { method: 'PUT', headers, body: file })
  if (!res.ok) {
    throw new Error(`attachment upload failed (${res.status})`)
  }
}

/** GET /docs/{docId}/attachments/{attachId} (needs reader) -> freshly signed GET url. */
export async function getReadUrl(docId: string, attachId: string): Promise<ReadResult> {
  const { data } = await apiClient().get<ReadResult>(`/docs/${docId}/attachments/${attachId}`)
  return data
}

/** One freshly-resolved attachment (signed display/download URL + metadata). */
export interface ResolvedAttachment {
  attachId: string
  /** Freshly signed, time-limited URL — used as the image src / download href. */
  url: string
  expiresInSec: number
  mime: string
  sizeBytes: number
  fileName: string
}

export interface ResolveResult {
  items: ResolvedAttachment[]
  /** attachIds the backend could not resolve (deleted / unknown). */
  notFound: string[]
}

/**
 * POST /docs/{docId}/attachments/resolve — batch-resolve fresh signed URLs for a set of
 * attachIds (export / re-render use). Per RES-1 the backend caps the batch (default 200);
 * the caller must chunk above that. 400 `attachIds_too_many` / `invalid_body` surface as
 * AttachmentRejectedError, consistent with presignUpload.
 */
export async function resolveAttachments(
  docId: string,
  attachIds: string[],
): Promise<ResolveResult> {
  try {
    const { data } = await apiClient().post<ResolveResult>(
      `/docs/${docId}/attachments/resolve`,
      { attachIds },
    )
    return { items: data.items ?? [], notFound: data.notFound ?? [] }
  } catch (e) {
    const err = e as ApiError<{ error?: string }>
    if (err.response?.status === 400) {
      throw new AttachmentRejectedError(err.response.data?.error ?? 'invalid_body')
    }
    throw e
  }
}

/** Node attrs produced by a successful upload: the durable attachId + a display src. */
export interface UploadedImage {
  attachId: string
  src: string | null
}

/**
 * End-to-end upload: presign -> PUT raw bytes -> resolve a signed display URL.
 * The durable reference is `attachId`; `src` is a cached, expiry-prone display URL
 * (null if the read endpoint is briefly unavailable — the NodeView re-resolves it
 * from attachId at render time). Never emits base64 (constraint §2).
 */
export async function uploadImage(docId: string, file: File): Promise<UploadedImage> {
  const presign = await presignUpload(docId, {
    fileName: file.name || 'image',
    mime: file.type,
    sizeBytes: file.size,
  })
  await uploadBinary(presign, file)
  let src: string | null = null
  try {
    src = (await getReadUrl(docId, presign.attachId)).url
  } catch {
    src = null
  }
  return { attachId: presign.attachId, src }
}

/** A source attachment to copy into the target doc (its owning doc + durable attachId). */
export interface CopySourceRef {
  docId: string
  attachId: string
}

/** One successful copy: source ref → new doc-scoped attachId + a freshly signed display URL. */
export interface CopyMapping {
  sourceDocId: string
  sourceAttachId: string
  attachId: string
  url: string
  mime: string
  sizeBytes: number
  fileName: string
}

export interface CopyResult {
  mappings: CopyMapping[]
  notCopied: Array<{ sourceDocId: string; sourceAttachId: string; reason: string }>
}

/**
 * POST /docs/{docId}/attachments/copy — server-to-server copy of already-stored attachments
 * into `docId`. Used by Markdown/PDF import to re-host images that reference another doc: the
 * backend copies the bytes store-to-store (no signed-URL download in the browser, so it never
 * expires) and enforces read permission on each source. Only attachments our service already
 * stores are eligible — a foreign/external image has no source ref and is never sent here.
 */
export async function copyAttachments(
  docId: string,
  sources: CopySourceRef[],
): Promise<CopyResult> {
  const { data } = await apiClient().post<CopyResult>(
    `/docs/${docId}/attachments/copy`,
    { sources },
  )
  return { mappings: data.mappings ?? [], notCopied: data.notCopied ?? [] }
}

/** One successful external-image ingest: original URL → new doc-scoped attachId + display URL. */
export interface IngestMapping {
  sourceUrl: string
  attachId: string
  url: string
  mime: string
  sizeBytes: number
}

export interface IngestResult {
  mappings: IngestMapping[]
  notIngested: Array<{ sourceUrl: string; reason: string }>
}

/**
 * POST /docs/{docId}/attachments/ingest — download EXTERNAL image URLs server-side (SSRF-guarded)
 * and store them under `docId`. Used by Markdown/PDF import to re-host images that are not our
 * own attachments, so the document does not break if the external host later disappears. On any
 * failure the caller keeps the original URL (best-effort).
 */
export async function ingestAttachments(
  docId: string,
  urls: string[],
): Promise<IngestResult> {
  const { data } = await apiClient().post<IngestResult>(
    `/docs/${docId}/attachments/ingest`,
    { urls },
  )
  return { mappings: data.mappings ?? [], notIngested: data.notIngested ?? [] }
}
