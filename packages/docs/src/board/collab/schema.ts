// Frozen shared schema — local seam for `@octo/whiteboard-schema` (XIN-16 §3).
//
// The XIN-16 contract mandates ONE frozen package shared by the FE binding, the BE authoritative
// repair, and the BE Agent conversion, so all three normalise elements by the *same* rule set
// (only the right to *write back* differs — FE repairs locally for render only, never writes to
// the Y.Doc; XIN-16 §3.2 / §4.2). That package is delivered by XIN-26.
//
// Per the PM (this issue), the package is the ONLY thing gating M2: the single point that must
// import it is `normalizeElement` inside the repair pass. Everything else in this file — the
// field-name constants, the schema version, the element-type whitelist, the doc-name key
// codec — is locked by the contract and defined here now so the binding is not blocked.
//
// ┌─ WHEN `@octo/whiteboard-schema` PUBLISHES (XIN-26 writes back "published @ <loc>/<ver>") ─┐
// │  Replace the bodies below with re-exports from the package, e.g.                           │
// │    export { ELEMENTS_FIELD, FILES_FIELD, WB_SCHEMA_VERSION, WB_ELEMENT_TYPES,              │
// │             normalizeElement, buildWhiteboardName, parseWhiteboardName }                   │
// │      from '@octo/whiteboard-schema'                                                        │
// │  and delete the placeholder `normalizeElement` below. The binding/repair call sites do not │
// │  change — they already import from this module.                                            │
// └────────────────────────────────────────────────────────────────────────────────────────────┘

import type { ExcalidrawElement } from './types.ts'
import { buildWhiteboardName as buildName, parseDocumentName } from '../../documentName/index.ts'

/** Top-level Y.Map holding elements, keyed by element id (XIN-16 §1). */
export const ELEMENTS_FIELD = 'elements' as const
/** Top-level Y.Map holding file *reference metadata* only — never binary (XIN-16 §2). */
export const FILES_FIELD = 'files' as const

/**
 * Whiteboard schema version, OWNED BY THIS PACKAGE and deliberately independent of the docs/PM
 * `SCHEMA_VERSION=15` (XIN-16 §6). `gateSchema` for boards must use this, not the PM version.
 */
export const WB_SCHEMA_VERSION = 1 as const

/** Element types Excalidraw supports; used by normalize to validate `type` (XIN-16 §3.1). */
export const WB_ELEMENT_TYPES: readonly string[] = [
  'rectangle',
  'ellipse',
  'diamond',
  'arrow',
  'line',
  'draw',
  'freedraw',
  'text',
  'image',
  'frame',
  'magicframe',
  'embeddable',
  'iframe',
  'selection',
]

/** Build the canonical board doc-name key `octo:{space}:{folder}:wb:{board}` (XIN-16 §3.1).
 *  Delegates to the validated single-source-of-truth codec (no inline `octo:` concatenation). */
export function buildWhiteboardName(space: string, folder: string, board: string): string {
  return buildName(space, folder, board)
}

/** Parse a board doc-name key back to its parts, or null when it is not a board key. */
export function parseWhiteboardName(
  name: string,
): { space: string; folder: string; board: string } | null {
  try {
    const parsed = parseDocumentName(name)
    return parsed.kind === 'whiteboard'
      ? { space: parsed.space, folder: parsed.folder, board: parsed.board }
      : null
  } catch {
    return null
  }
}

/**
 * PLACEHOLDER — superseded by `@octo/whiteboard-schema.normalizeElement` (XIN-26).
 *
 * The authoritative repair (dangling binding M-2 / orphan bound-text M-5 / one-sided
 * boundElements M-8 / half-group M-7 / frameId M-3) lives in the shared package so FE and BE
 * agree byte-for-byte. Until it publishes, this placeholder is an identity pass that ONLY proves
 * the seam (preserves all fields, including unknown ones — M-12). It performs no cross-element
 * graph repair; the repair pass (./repair.ts) and the M-2/M-5/M-8 cases stay deferred until the
 * real rule set lands, exactly as scoped by the PM.
 *
 * @param el   the element to normalise
 * @returns a normalised copy (here: a shallow clone preserving every field verbatim)
 */
export function normalizeElement(el: ExcalidrawElement): ExcalidrawElement {
  // Identity passthrough: unknown fields preserved, nothing dropped (M-12). Real graph-level
  // repair arrives with the shared package.
  return { ...el }
}

/** True once this seam has been replaced by the real shared package. Flips with the re-export. */
export const SCHEMA_PACKAGE_WIRED = false
