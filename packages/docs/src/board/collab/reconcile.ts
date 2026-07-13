// CAS arbitration (XIN-16 §1.1) — delegated to the shared `elementSupersedes` from
// `@octo/whiteboard-schema`, so the front-end arbitrates writes by the exact same rule the
// backend authoritative repair uses (higher version wins; equal version → smaller versionNonce
// wins; fully equal → no write). Read-before-write is enforced by the caller (binding.ts): it
// reads the current Y.Map stamp and only writes when this says the incoming element wins, so no
// no-op transaction fires (the empty-diff guard's arithmetic half).

import { elementSupersedes } from './schema.ts'
import type { ExcalidrawElement } from './types.ts'

export { elementSupersedes } from './schema.ts'

/** A CAS stamp: an element or just its version-relevant fields. */
export interface VersionStamp {
  version: number
  versionNonce: number
}

/**
 * Decide whether `incoming` should overwrite `current` — thin wrapper over the shared
 * `elementSupersedes` (treats a missing current as "incoming wins").
 */
export function shouldOverwrite(
  current: VersionStamp | null | undefined,
  incoming: VersionStamp,
): boolean {
  return elementSupersedes(current ?? undefined, incoming)
}

/** Reconcile one element against the current authoritative value (tombstones converge by version). */
export function reconcileElement(
  current: ExcalidrawElement | null | undefined,
  incoming: ExcalidrawElement,
): ExcalidrawElement {
  return shouldOverwrite(current, incoming) ? incoming : (current as ExcalidrawElement)
}
