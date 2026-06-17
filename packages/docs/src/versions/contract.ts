// Canonical version-history wire contract — the SINGLE SOURCE OF TRUTH for the
// field names and shapes exchanged on the wire between this frontend and the
// octo-docs-backend version-history endpoints.
//
// WHY THIS FILE EXISTS
// --------------------
// The version-history endpoints are split across two repos. Before this module,
// each side hand-mocked the wire shape it *assumed* the other produced, so both
// repos' unit tests stayed green while the actual field names drifted apart
// (backend emitted `id`/`name`, frontend read `docVersionSeq`/`label`). The
// real-browser walkthrough surfaced the mismatch only at runtime.
//
// This module pins the canonical field names + representative golden payloads so
// the frontend's contract tests (contract.test.ts) drive the REAL api.ts code
// against these fixtures instead of inventing inline wire shapes. The backend
// (octo-docs-backend) must serialize/parse byte-for-byte to these field names;
// any drift on either side is caught by the contract test's drift guards.
//
// This is the version-history slice of what the published `@octo/docs-schema`
// package will export so the frontend, the backend Agent layer, and CLI tooling
// share one definition. Re-exported from src/schema/index.ts (the schema
// single-source-of-truth module) for discoverability.
//
// AUTHORITY: version-history-design-draft-v0.4 §7 (FROZEN endpoint table):
//   GET    /docs/:docId/versions?cursor=<docVersionSeq>&limit=<n>
//            -> { items:[{docVersionSeq,kind,label,createdBy,createdAt,sizeBytes,schemaVersion,restoredFrom}], nextCursor }
//   POST   /docs/:docId/versions            body:{ label? } -> { docVersionSeq }
//   GET    /docs/:docId/versions/:docVersionSeq/state        -> binary Yjs state blob
//   POST   /docs/:docId/versions/:docVersionSeq/restore      -> { newDocVersionSeq, restoredFrom }
//   PATCH  /docs/:docId/versions/:docVersionSeq  body:{ label } -> rename (named only)
//   DELETE /docs/:docId/versions/:docVersionSeq              -> delete a historical row
//
// RULE: field names below are canonical. Do not rename a field here without
// bumping the contract in lockstep with the backend stub and the design doc.

/**
 * Canonical wire field names. Exported as a frozen record so a contract test can
 * assert the exact set and fail loudly if anyone renames a field on either side.
 * Keys are stable identifiers used in tests; values are the literal wire keys.
 */
export const VERSION_WIRE_FIELDS = {
  /** Version identifier on every version row and as the create/list anchor. */
  docVersionSeq: 'docVersionSeq',
  /** Version kind (numeric on the wire: 1=auto, 2=named, 3=restore-marker). */
  kind: 'kind',
  /** User label for named snapshots (empty string for auto/restore rows). */
  label: 'label',
  /** Uid of the actor that created the version. */
  createdBy: 'createdBy',
  /** ISO-8601 creation timestamp. */
  createdAt: 'createdAt',
  /** Serialized size of the version state blob in bytes. */
  sizeBytes: 'sizeBytes',
  /** Schema version the blob was written under. */
  schemaVersion: 'schemaVersion',
  /** For restore-marker rows / restore responses: the seq restored from (else null). */
  restoredFrom: 'restoredFrom',
  /** Restore response: the new version seq created by the restore. */
  newDocVersionSeq: 'newDocVersionSeq',
  /** List pagination cursor field in the response body. */
  nextCursor: 'nextCursor',
  /** List pagination query-string params. */
  cursor: 'cursor',
  limit: 'limit',
} as const

export type VersionWireFieldName = (typeof VERSION_WIRE_FIELDS)[keyof typeof VERSION_WIRE_FIELDS]

// --- Canonical wire shapes (exactly what crosses the wire) -------------------

/** Wire shape of one version row. `kind` is numeric on the wire (see VersionKind mapping). */
export interface WireVersionRow {
  docVersionSeq: number
  kind: number
  label: string
  createdBy: string
  createdAt: string
  sizeBytes: number
  schemaVersion: number
  restoredFrom: number | null
}

/** GET /docs/:docId/versions response body. */
export interface WireListVersionsResponse {
  items: WireVersionRow[]
  nextCursor: number | null
}

/** POST /docs/:docId/versions request body (label optional). */
export interface WireCreateVersionRequest {
  label?: string
}

/** POST /docs/:docId/versions response body. */
export interface WireCreateVersionResponse {
  docVersionSeq: number
}

/** POST /docs/:docId/versions/:seq/restore response body. */
export interface WireRestoreResponse {
  newDocVersionSeq: number
  restoredFrom: number
}

/** PATCH /docs/:docId/versions/:seq request body. */
export interface WireRenameVersionRequest {
  label: string
}
