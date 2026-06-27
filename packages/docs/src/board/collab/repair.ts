// Merge-time binding-consistency repair pass (selection B, XIN-24) — FE LOCAL/render-only.
//
// Runs the SHARED `normalizeElement` rule set from `@octo/whiteboard-schema` over a freshly
// merged/rebuilt scene, for LOCAL RENDER ONLY. The FE NEVER writes the result back to the Y.Doc;
// the backend authoritative repair is the single writer (XIN-16 §4) and broadcasts the canonical
// state, which the FE then renders.
//
// Two passes, mirroring the backend `planRepair` so FE and BE agree on the surviving-id set:
//   1. survivors  — normalize each element with only `fileIds` context; an element with a
//                   missing/blank id, a non-whitelisted `type`, or (image) a dangling `fileId`
//                   normalises to null and is dropped.
//   2. prune       — re-normalize the survivors with `elementIds = survivors`, so dangling
//                   `boundElements` entries (one-sided binding, M-8) are pruned and a dangling
//                   `frameId` (M-3) is cleared against the correct surviving set.
//
// Graph-level repair that needs whole-set WRITE authority — fractional-index reassignment and
// file GC — is intentionally NOT done here; it is backend-authoritative (`repairLiveDoc`) and the
// FE receives its result over the wire. This pass only makes the local render self-consistent.

import { normalizeElement } from './schema.ts'
import type { ExcalidrawElement } from './types.ts'

/**
 * Normalise a freshly-rebuilt scene for LOCAL RENDER ONLY (never written back to the Y.Doc).
 *
 * @param elements elements as read out of the Y.Doc after a merge / remote apply
 * @param fileIds  ids present in the `files` container, so dangling-image elements are dropped
 * @returns a normalised, self-consistent copy safe to hand to `updateScene`
 */
export function repairForRender(
  elements: readonly ExcalidrawElement[],
  fileIds?: ReadonlySet<string>,
): ExcalidrawElement[] {
  // Pass 1: decide survivors over all ids (drop bad id/type / dangling-image) so pass-2 reference
  // pruning sees the correct surviving-id set.
  const survivors = new Set<string>()
  for (const el of elements) {
    const n = normalizeElement(el, { fileIds })
    if (n) survivors.add(n.id)
  }

  // Pass 2: re-normalize against the survivor set to prune dangling references (M-8 / M-3).
  const out: ExcalidrawElement[] = []
  for (const el of elements) {
    const n = normalizeElement(el, { elementIds: survivors, fileIds })
    if (n) out.push(n as ExcalidrawElement)
  }
  return out
}
