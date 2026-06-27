/**
 * @octo/whiteboard-schema — frozen shared constants (XIN-16 §3).
 *
 * This module is the FROZEN shared whiteboard schema package described by the
 * XIN-16 single-authority contract. It is the analogue of `@octo/docs-schema`
 * for ProseMirror docs (which lives as the local stand-in `src/schema/index.ts`
 * in this repo): the front-end Excalidraw binding (XIN-25), the back-end
 * authoritative repair extension, and the back-end Agent conversion path MUST
 * all import the SAME constants and the SAME `normalizeElement` rule set from
 * here — never hard-code field names or rules on one side. Front-end and
 * back-end share this source verbatim; divergence reintroduces the exact
 * FE/BE layout drift XIN-15 ③ flagged.
 *
 * Nothing in this package depends on Yjs or any backend module, so the
 * front-end can vendor/import it unchanged. The Y.Map <-> element/file
 * adapters that DO touch Yjs live outside the package (src/whiteboard/ydoc.ts).
 */

/** Top-level Y.Map container holding elements, keyed by element id (§1). */
export const ELEMENTS_FIELD = 'elements'

/** Top-level Y.Map container holding file reference metadata, keyed by fileId (§2). */
export const FILES_FIELD = 'files'

/**
 * Whiteboard schema version, OWNED by this frozen package and INTENTIONALLY
 * isolated from the ProseMirror `SCHEMA_VERSION = 15` (§6 / XIN-14 §8.2 risk 6).
 * `doc_version.schema_version` for whiteboards gates on this value, never on the
 * PM version. Bump in lockstep with the front-end whenever the element schema /
 * normalize rule set changes.
 *
 *   v1 — baseline: id/type validation, version/versionNonce, numeric clamps,
 *        fractional-index strip, dangling `boundElements` + `frameId` pruning.
 *   v2 — M-5: dangling `containerId` pruning (orphaned bound-text whose container
 *        element was deleted -> containerId null), same shape as the v1 frameId
 *        rule. No new element type; unknown-field passthrough unchanged.
 */
export const WB_SCHEMA_VERSION = 2

/**
 * Excalidraw element `type` whitelist (v1). An element whose `type` is not in
 * this set is not renderable and is dropped by repair / local normalize. The
 * set mirrors the Excalidraw v1 element types the front-end binding emits.
 */
export const WB_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'rectangle',
  'ellipse',
  'diamond',
  'arrow',
  'line',
  'freedraw',
  'text',
  'image',
  'frame',
  'embeddable',
])

/** Element types whose `fileId` must resolve to a `files` container entry (§2). */
export const FILE_BEARING_TYPES: ReadonlySet<string> = new Set(['image'])

/** Canonical field set stored per file reference in the `files` Y.Map (§2.2). */
export const FILE_REF_FIELDS = ['attachId', 'mimeType', 'status', 'createdAt'] as const

/**
 * Origin tag for server-authoritative repair transactions (§4.1, gate 1). The
 * repair observer MUST skip any transaction carrying this origin, so its own
 * corrective writes never re-trigger repair (anti-self-excitation).
 */
export const REPAIR_ORIGIN = 'wb-repair'

/**
 * Reserved, FIXED Yjs clientID used when repair materializes a canonical state
 * from scratch (the cold-start / failover path, BE-M11). A constant clientID is
 * what makes `encodeStateAsUpdate` byte-identical across independent instances
 * repairing the same illegal input: new structs created by repair are attributed
 * to the same client on every node, so two owner nodes that both repair the same
 * state during failover converge to identical bytes instead of diverging.
 * Picked high to avoid colliding with `random.uint32()`-assigned client ids.
 */
export const REPAIR_CLIENT_ID = 0x7fffffff
