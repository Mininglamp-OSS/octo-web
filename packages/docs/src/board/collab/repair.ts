// Merge-time binding-consistency repair pass (selection B, XIN-24) — FE LOCAL/render-only.
//
// ⚠️ THE ONE PACKAGE-GATED PIECE (per the PM on this issue). The authoritative repair rule set —
// dangling binding (M-2) / orphan bound-text (M-5) / one-sided boundElements (M-8) / half-group
// (M-7) / dangling frameId (M-3) — ships as `normalizeElement` in `@octo/whiteboard-schema`
// (XIN-26), so FE and BE repair by the SAME rules. The FE applies it ONLY to the scene it renders
// and NEVER writes the result back to the Y.Doc; the server-authoritative repair is the single
// writer (XIN-16 §4).
//
// Until `@octo/whiteboard-schema` publishes, `normalizeElement` is the identity placeholder in
// ./schema.ts, so this pass is a structural no-op that proves the seam (and the unknown-field
// passthrough, M-12). When the package lands:
//   1. point ./schema.ts at the real `@octo/whiteboard-schema` (one-line re-export swap);
//   2. un-skip the M-2 / M-5 / M-8 cases in __tests__/repair.test.ts;
//   3. nothing here changes — the call site already imports `normalizeElement` from the seam.

import { normalizeElement } from './schema.ts'
import type { ExcalidrawElement } from './types.ts'

/**
 * Normalise a freshly-rebuilt scene for LOCAL RENDER ONLY (never written back to the Y.Doc).
 *
 * @param elements elements as read out of the Y.Doc after a merge / remote apply
 * @returns a normalised copy safe to hand to `updateScene`
 */
export function repairForRender(elements: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  // Per-element normalize (identity until the shared rule set lands). The graph-level passes that
  // need to see the WHOLE element set (cross-element dangling-binding / orphan / one-sided checks)
  // are implemented inside the shared `normalizeElement` rule set in XIN-26; this call site does
  // not need to change when they arrive.
  return elements.map((el) => normalizeElement(el))
}
