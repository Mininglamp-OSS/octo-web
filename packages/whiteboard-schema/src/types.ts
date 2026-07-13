/**
 * @octo/whiteboard-schema — shared element / file reference types (XIN-16 §1/§2).
 *
 * These are plain-object shapes (no Yjs). The contract stores each element as a
 * per-element `Y.Map<field, value>` and each file reference as a per-file
 * `Y.Map<field, value>`; these types describe the field set those maps carry.
 * Unknown fields are intentionally allowed (`[k: string]: unknown`) because §6
 * mandates unknown-field passthrough across all three sides.
 */

/** A whiteboard element (Excalidraw element subset + unknown passthrough). */
export interface WhiteboardElement {
  id: string
  type: string
  /** monotonic version for CAS arbitration (§1.1). */
  version: number
  /** tiebreaker when versions are equal — smaller wins (§1.1). */
  versionNonce: number
  /** fractional-index string expressing z-order (§1.1). */
  index?: string
  /** soft-delete tombstone (§1.1) — never hard-delete the key. */
  isDeleted?: boolean
  /** image elements reference a `files` container entry by this key (§2). */
  fileId?: string | null
  /** ids of elements bound to this one (e.g. arrow labels); dangling refs pruned. */
  boundElements?: Array<{ id: string; type: string }> | null
  /** containing frame element id; cleared if dangling. */
  frameId?: string | null
  /** container element a bound text belongs to; cleared if dangling (M-5). */
  containerId?: string | null
  /** unknown / future fields preserved verbatim (§6). */
  [k: string]: unknown
}

/** A file reference entry stored in the top-level `files` Y.Map (§2.2). */
export interface FileRef {
  /** object-storage attachment id (binary lives there, NEVER in the Y.Doc). */
  attachId: string
  mimeType?: string
  status?: string
  createdAt?: number
  [k: string]: unknown
}

/** Context passed to normalizeElement so it can prune dangling references (§4.1). */
export interface NormalizeContext {
  /** ids of all (non-tombstoned) elements present in the doc. */
  elementIds?: ReadonlySet<string>
  /** fileIds present in the `files` container. */
  fileIds?: ReadonlySet<string>
}
