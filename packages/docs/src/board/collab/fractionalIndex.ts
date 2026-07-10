// Fractional-index render-defence (FE local, render-only).
//
// Excalidraw expresses z-order with a fractional-index key (`element.index`) whose grammar is
// defined by the `fractional-indexing` library it bundles: a head char (`a`–`z` / `A`–`Z`) that
// encodes the integer part's LENGTH, that many base-62 integer digits, then an optional base-62
// fractional part whose last digit is never `0`. `restoreElements` / `reconcileElements` call
// `syncInvalidIndices` → `generateNKeysBetween`, which passes neighbouring keys straight to the
// library's `validateOrderKey`; a key it cannot parse makes the WHOLE apply throw.
//
// The shared `@octo/whiteboard-schema` `isValidIndex` only checks the loose `/^[A-Za-z0-9]+$/`
// charset (deliberately — it is the FE/BE contract and the backend authoritative repair writes
// under it). The backend fills a missing key with a zero-padded scheme (`r00000000`, see
// octo-docs-backend `whiteboard/repair.ts`) that passes that loose check but is NOT a valid
// Excalidraw key: head `r` claims a 19-digit integer part while only 9 chars follow. Such a key
// renders fine as long as the scene never needs an index REGENERATED (all keys already ordered),
// but the moment one does — a local element inserted between two remote ones, a non-monotonic /
// rolled-over backend batch, a duplicate — `generateNKeysBetween` throws `invalid order key`,
// `applyRemote` swallows it (P1-2 batch guard), and the canvas paints EMPTY. That is the
// bot-written-board blank-render failure (octo-docs-backend #51 / XIN-791).
//
// This pass detects keys Excalidraw's grammar rejects and DROPS them (render-only, never written
// back to the Y.Doc — the backend stays the authoritative index writer, XIN-16 §4), letting
// Excalidraw's own `syncInvalidIndices` assign fresh, valid keys. Order is preserved by
// stable-sorting on the original key strings first — the same string comparison Excalidraw's
// `orderByFractionalIndex` uses and the ordering the backend's zero-padded scheme intends — so a
// bot scene keeps its authored z-order. Scenes whose keys are already all valid (every
// human-drawn board) take a zero-copy fast path and are handed through untouched, so existing
// real-time collaboration / reconcile behaviour does not change.

import type { ExcalidrawElement } from './types.ts'

const BASE_62_DIGITS = new Set(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split(''),
)

/**
 * Integer-part length a fractional-index head char encodes, or -1 for a non-head char. Mirrors
 * `fractional-indexing`'s `getIntegerLength`: `a`→2 … `z`→27 (positive), `Z`→2 … `A`→27 (negative).
 */
function integerLengthFromHead(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2
  return -1
}

/**
 * True when `key` is a fractional-index string Excalidraw's `fractional-indexing` can parse —
 * i.e. one `generateKeyBetween`/`validateOrderKey` will accept as a neighbour bound. Faithful to
 * that library's `validateOrderKey` + `getIntegerPart`, with the extra guarantee that every digit
 * is base-62 (a non-base-62 fractional char parses in `validateOrderKey` but breaks the base-62
 * arithmetic in `generateNKeysBetween`, so treating it as invalid here is the safe, stricter call).
 */
export function isExcalidrawFractionalIndex(key: unknown): key is string {
  if (typeof key !== 'string' || key.length === 0) return false
  // The one explicitly-forbidden key in the library (smallest-integer sentinel).
  if (key === 'A' + '0'.repeat(26)) return false
  const intLen = integerLengthFromHead(key[0])
  if (intLen < 0 || intLen > key.length) return false
  for (let i = 1; i < key.length; i++) {
    if (!BASE_62_DIGITS.has(key[i])) return false
  }
  // A fractional part is never allowed to end in the smallest digit (`0`).
  const frac = key.slice(intLen)
  if (frac.length > 0 && frac[frac.length - 1] === '0') return false
  return true
}

/**
 * Make a rebuilt scene safe for Excalidraw's restore/reconcile by dropping any `index` key its
 * fractional-indexing grammar would reject. Render-only: the returned elements are never written
 * back to the Y.Doc.
 *
 * Fast path: if every element already carries a valid key (or none), the input array is returned
 * as-is — no reorder, no copy — so ordinary human-drawn boards are untouched. Otherwise a new,
 * stable-sorted array is returned with the invalid keys stripped, so Excalidraw's
 * `syncInvalidIndices` regenerates valid keys in the authored z-order instead of throwing.
 */
export function sanitizeFractionalIndices(
  elements: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] {
  let anyInvalid = false
  for (const el of elements) {
    const idx = el.index
    if (idx != null && !isExcalidrawFractionalIndex(idx)) {
      anyInvalid = true
      break
    }
  }
  if (!anyInvalid) return elements

  // Preserve authored order (elements with no key sort first, matching Excalidraw's own
  // treatment of a missing index as ordering-first), keeping ties in original array order.
  const positioned = elements.map((el, i) => ({ el, i }))
  positioned.sort((a, b) => {
    const ka = typeof a.el.index === 'string' ? a.el.index : ''
    const kb = typeof b.el.index === 'string' ? b.el.index : ''
    if (ka < kb) return -1
    if (ka > kb) return 1
    return a.i - b.i
  })
  return positioned.map(({ el }) => {
    const idx = el.index
    if (idx != null && !isExcalidrawFractionalIndex(idx)) {
      // Drop only the offending key; every other field (unknown ones included) passes through.
      const { index: _dropped, ...rest } = el
      return rest as ExcalidrawElement
    }
    return el
  })
}
