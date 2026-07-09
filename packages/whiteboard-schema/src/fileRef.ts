/**
 * @octo/whiteboard-schema — `files` container entry (FileRef) contract helpers.
 *
 * The whiteboard image path keeps the binary in object storage and stores ONLY
 * a reference in the Y.Doc `files` container (§2.2). That reference is the exact
 * handoff between the two halves of image support:
 *   · back-end (octo-docs-backend) mints a stable `attachId` at presign time
 *     (POST /api/v1/docs/{docId}/attachments/presign) and serves the binary back
 *     by that id (GET .../attachments/{attachId});
 *   · front-end (XIN-702) stores the returned `attachId` — plus `mimeType`,
 *     `status`, `createdAt` — as `files[fileId]` in the scene Y.Doc, and on a
 *     remote render re-fetches the binary by `attachId` and `addFiles()`s it into
 *     Excalidraw.
 *
 * A FileRef with no usable `attachId` is the XIN-699 grey-placeholder bug in data
 * form: the image element survives (its `fileId` is present in the container) yet
 * no peer can ever retrieve a binary. So the single authoritative rule for "is
 * this file ref usable" lives HERE, in the frozen package both sides import
 * verbatim, exactly like `normalizeElement` owns the element rule set — the two
 * sides can never disagree on what a valid image reference looks like.
 *
 * These functions are PURE and DETERMINISTIC (no clock reads, no randomness): a
 * `createdAt` is always supplied by the caller, never read from `Date.now()`,
 * mirroring the no-clock discipline `normalizeElement` keeps for reproducible
 * cross-instance repair. The input is never mutated.
 */
import type { FileRef } from './types.ts'

/**
 * Canonical `status` values for a file reference. `pending` is the transient
 * state between "presign issued" and "PUT confirmed"; `saved` is the durable
 * state a collaborator can fetch. Unknown/absent status is tolerated on read
 * (treated as `saved`) so a ref written by a newer front-end still resolves.
 */
export const FILE_REF_STATUS = {
  pending: 'pending',
  saved: 'saved',
} as const

export type FileRefStatus = (typeof FILE_REF_STATUS)[keyof typeof FILE_REF_STATUS]

/** A non-empty string is the only shape an object-storage `attachId` can take. */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/**
 * Build the canonical `files[fileId]` entry the front-end stores after a
 * successful presign. `attachId` is the id the backend returned; `mimeType`
 * SHOULD be the same value that was presigned so the read-time
 * `Content-Disposition`/inline decision stays consistent. `createdAt` is passed
 * in (epoch ms) — this helper never reads the clock — and `status` defaults to
 * `saved` for the common "upload already confirmed" call site.
 *
 * Unknown extra fields supplied by the caller are preserved verbatim (§6
 * passthrough) so a newer front-end can carry additional metadata without a
 * schema bump.
 */
export function buildFileRef(input: {
  attachId: string
  mimeType?: string
  status?: FileRefStatus
  createdAt?: number
  [k: string]: unknown
}): FileRef {
  const { attachId, mimeType, status, createdAt, ...rest } = input
  const ref: FileRef = { ...rest, attachId }
  if (mimeType !== undefined) ref.mimeType = mimeType
  ref.status = status ?? FILE_REF_STATUS.saved
  if (createdAt !== undefined) ref.createdAt = createdAt
  return ref
}

/**
 * Normalize a raw `files` container entry into a canonical FileRef, or return
 * `null` when it carries no usable `attachId` (the reference can never resolve
 * to a binary — the grey-placeholder failure mode). Numeric `createdAt` is kept
 * only when finite; a non-string/blank `mimeType` or `status` is dropped rather
 * than trusted. Unknown fields pass through (§6). The input is not mutated.
 */
export function normalizeFileRef(entry: unknown): FileRef | null {
  if (!entry || typeof entry !== 'object') return null
  const src = entry as Record<string, unknown>
  if (!isNonEmptyString(src.attachId)) return null

  const out: FileRef = { ...(src as Record<string, unknown>), attachId: src.attachId } as FileRef

  if (isNonEmptyString(src.mimeType)) out.mimeType = src.mimeType
  else delete out.mimeType

  if (isNonEmptyString(src.status)) out.status = src.status
  else delete out.status

  if (typeof src.createdAt === 'number' && Number.isFinite(src.createdAt)) out.createdAt = src.createdAt
  else delete out.createdAt

  return out
}

/**
 * True iff `entry` is a usable file reference — i.e. `normalizeFileRef` keeps it.
 * A convenience predicate for callers that only need to gate on usability (e.g.
 * deciding whether an image element's `fileId` resolves to a fetchable binary).
 */
export function isUsableFileRef(entry: unknown): boolean {
  return normalizeFileRef(entry) !== null
}
