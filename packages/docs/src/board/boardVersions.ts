// Board version-history REST glue — the whiteboard counterpart of versions/api.ts.
//
// The list / create / rename / delete endpoints are document-kind-agnostic (they operate on
// /docs/:docId/versions and never look at the payload), so the board REUSES versions/api.ts for
// those UNCHANGED — same as SheetVersionPanel does. Only two things are board-specific and live
// here:
//   1. getBoardVersionState — the /state endpoint returns a `board` payload
//      `{ kind:'board', scene:{ elements, files }, schemaVersion, docVersionSeq }` instead of the
//      doc's ProseMirror `{ doc, ... }`. We go through the shared getVersionState (so the 409
//      schema mapping stays in one place) and read the board scene off the response, mirroring how
//      SheetVersionPanel casts the same call to `{ sheetCells }`.
//   2. versionErrorKey — restore/preview surface a wider set of failures than the doc panel
//      (403 epoch_changed / access revoked, 409 conflict, 413 payload too large, 404 gone), and the
//      panel needs a distinct, localized message for each. This pure classifier keeps that mapping
//      testable in isolation.

import { getVersionState, VersionSchemaIncompatibleError, VersionSchemaNewerError } from '../versions/api.ts'

/** The decoded Excalidraw scene of a historical board version (index-ordered elements + files). */
export interface BoardVersionScene {
  /** `unknown[]` keeps this module free of the Excalidraw element types (client-only import). */
  elements: unknown[]
  /** Binary file store (images etc.), keyed by file id, as Excalidraw consumes it. */
  files?: Record<string, unknown>
}

/** Decoded board version state for the read-only scene preview. */
export interface BoardVersionState {
  scene: BoardVersionScene
  schemaVersion: number
  docVersionSeq: number
}

// Wire shape of the board /state response. `getVersionState` returns the raw JSON unchanged; the
// board build reads `scene` off it (the doc build reads `doc`), so we cast at this boundary — the
// same pattern the sheet panel uses for `sheetCells`.
interface WireBoardVersionState {
  scene?: { elements?: unknown[]; files?: Record<string, unknown> }
  schemaVersion?: number
  docVersionSeq?: number
}

/**
 * GET /docs/:docId/versions/:seq/state → decoded board scene for the read-only preview (reader+).
 * Reuses the shared getVersionState so the two 409 schema codes still map to the same typed errors;
 * defensively normalizes the scene so a malformed/empty payload renders as an empty board rather
 * than throwing in the preview.
 */
export async function getBoardVersionState(
  docId: string,
  docVersionSeq: number,
  signal?: AbortSignal,
): Promise<BoardVersionState> {
  const raw = (await getVersionState(docId, docVersionSeq, signal)) as unknown as WireBoardVersionState
  const scene = raw.scene ?? {}
  return {
    scene: {
      elements: Array.isArray(scene.elements) ? scene.elements : [],
      files: scene.files && typeof scene.files === 'object' ? scene.files : undefined,
    },
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0,
    docVersionSeq: typeof raw.docVersionSeq === 'number' ? raw.docVersionSeq : docVersionSeq,
  }
}

/** Minimal structural view of the HTTP status on a rejected apiClient call. */
function statusOf(e: unknown): number | undefined {
  const resp = (e as { response?: { status?: number } } | null)?.response
  return typeof resp?.status === 'number' ? resp.status : undefined
}

/**
 * Map any error thrown by a version call to the i18n key of a user-facing message. Covers the full
 * board restore/preview failure surface the P1 contract can return:
 *   - schema-newer / schema-incompatible (typed 409 errors from versions/api.ts)
 *   - 403 → access revoked / epoch changed (can't restore)
 *   - 409 → concurrent conflict (refresh and retry)
 *   - 413 → version payload too large
 *   - 404 → the version no longer exists
 * Anything else falls back to the caller-supplied generic key (errPreview / errRestore).
 */
export function versionErrorKey(e: unknown, fallbackKey: string): string {
  if (e instanceof VersionSchemaNewerError) return 'docs.board.version.errSchemaNewer'
  if (e instanceof VersionSchemaIncompatibleError) return 'docs.board.version.errSchemaIncompatible'
  switch (statusOf(e)) {
    case 403:
      return 'docs.board.version.errForbidden'
    case 409:
      return 'docs.board.version.errConflict'
    case 413:
      return 'docs.board.version.errTooLarge'
    case 404:
      return 'docs.board.version.errNotFound'
    default:
      return fallbackKey
  }
}
