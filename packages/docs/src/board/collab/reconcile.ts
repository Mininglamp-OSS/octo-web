// CAS (compare-and-set) arbitration for element writes (XIN-16 §1.1).
//
// Mirrors Excalidraw's official `reconcileElements` ordering so a board converges identically
// whether two edits race through the Y.Doc or through Excalidraw's own reconciler:
//   1. higher `version` wins;
//   2. on equal `version`, lower `versionNonce` wins (deterministic, content-independent);
//   3. fully equal (version + versionNonce) ⇒ same logical state ⇒ DO NOT write.
//
// "Write before read" is forbidden: every write path reads the current Y.Map value first and only
// produces a transaction when this function says the incoming element should win. Skipping equal
// writes is what keeps `observe` from firing on no-op transactions (the empty-diff guard's
// arithmetic half — see binding.ts).

import type { ExcalidrawElement } from './types.ts'

/** A minimal version stamp; either a full element or just its CAS-relevant fields. */
export interface VersionStamp {
  version?: number
  versionNonce?: number
}

function ver(e: VersionStamp | null | undefined): number {
  return typeof e?.version === 'number' ? e.version : -1
}

function nonce(e: VersionStamp | null | undefined): number {
  // Absent nonce sorts last (largest) so a stamped element beats an unstamped one on a version tie.
  return typeof e?.versionNonce === 'number' ? e.versionNonce : Number.MAX_SAFE_INTEGER
}

/**
 * Decide whether `incoming` should overwrite `current`.
 *
 * @returns true iff incoming strictly wins by the §1.1 rules. Equal stamps return false (no-op).
 */
export function shouldOverwrite(
  current: VersionStamp | null | undefined,
  incoming: VersionStamp,
): boolean {
  if (current == null) return true // nothing there yet
  const cv = ver(current)
  const iv = ver(incoming)
  if (iv !== cv) return iv > cv // higher version wins
  // version tie → lower nonce wins
  const cn = nonce(current)
  const inNonce = nonce(incoming)
  if (inNonce !== cn) return inNonce < cn
  return false // identical stamp → same state → no write
}

/**
 * Reconcile a single element against the current authoritative value, honouring tombstones.
 *
 * A delete is modelled as `isDeleted=true` with a bumped `version` (never a key removal), so
 * "one peer deletes while another edits" converges by version like any other field (XIN-16 §1.1).
 *
 * @returns the winning element (may be `current` unchanged, or `incoming`).
 */
export function reconcileElement(
  current: ExcalidrawElement | null | undefined,
  incoming: ExcalidrawElement,
): ExcalidrawElement {
  return shouldOverwrite(current, incoming) ? incoming : (current as ExcalidrawElement)
}
