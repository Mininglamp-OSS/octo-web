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
// Excalidraw's own `syncInvalidIndices` assign fresh, valid keys. Z-order is preserved per scene
// shape: a HOMOGENEOUS bot scene (only the backend's unparseable scheme) is stable-sorted on the
// raw key strings — the same comparison Excalidraw's `orderByFractionalIndex` uses and the order
// the backend's zero-padded scheme intends — because its source array order is arbitrary Y.Map
// iteration order. A MIXED scene (valid Excalidraw keys alongside the backend scheme) is NEVER
// sorted: the two key spaces are not comparable as strings (`'a5' < 'r00000000'`), so a global
// sort would invert the author's stacking; instead the original array order is preserved and
// `syncInvalidIndices` regenerates only the stripped keys in place. Scenes whose keys are already
// all valid (every human-drawn board) take a zero-copy fast path and are handed through untouched,
// so existing real-time collaboration / reconcile behaviour does not change.

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
 * as-is — no reorder, no copy — so ordinary human-drawn boards are untouched.
 *
 * Otherwise the invalid keys are stripped and the array is handed to Excalidraw in the z-order its
 * `syncInvalidIndices` will honour, with the choice of order gated on whether the scene is
 * HOMOGENEOUS or MIXED:
 *
 *  - HOMOGENEOUS (every keyed element uses the backend's unparseable scheme, no valid Excalidraw
 *    key present): the source array order is arbitrary (Y.Map iteration order), but the backend's
 *    zero-padded scheme is string-monotonic, so a stable sort on the raw key strings recovers the
 *    authored z-order. This is the fuzz-verified pure-bot-board path — kept byte-for-byte.
 *
 *  - MIXED (valid Excalidraw keys coexist with the backend scheme): the two key spaces are NOT
 *    comparable as strings — a valid key like `a5` sorts before `r00000000`, so a global string
 *    sort silently drags every valid-keyed element beneath the bot scheme and inverts the author's
 *    stacking (the mixed-scene z-order corruption fixed here). We therefore do NOT sort a mixed
 *    scene: Excalidraw's own `syncInvalidIndices` treats ARRAY ORDER as the desired stacking and
 *    only regenerates the stripped keys in place, so preserving the original order keeps the
 *    valid-keyed elements' relative order intact and re-slots the stripped (bot) elements back at
 *    their original anchors.
 */
export function sanitizeFractionalIndices(
  elements: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] {
  let anyInvalid = false
  let anyValidKey = false
  for (const el of elements) {
    const idx = el.index
    if (idx == null) continue
    if (isExcalidrawFractionalIndex(idx)) anyValidKey = true
    else anyInvalid = true
  }
  if (!anyInvalid) return elements

  // Drop only the offending key; every other field (unknown ones included) passes through.
  const strip = (el: ExcalidrawElement): ExcalidrawElement => {
    const idx = el.index
    if (idx != null && !isExcalidrawFractionalIndex(idx)) {
      const { index: _dropped, ...rest } = el
      return rest as ExcalidrawElement
    }
    return el
  }

  // MIXED scene: never string-sort across the two incomparable key spaces — preserve the author's
  // array order and let syncInvalidIndices regenerate only the stripped keys in place.
  if (anyValidKey) return elements.map(strip)

  // HOMOGENEOUS scene: stable-sort on the raw key strings to recover the authored order from the
  // arbitrary Y.Map iteration order (elements with no key sort first, matching Excalidraw's own
  // treatment of a missing index as ordering-first), keeping ties in original array order.
  const positioned = elements.map((el, i) => ({ el, i }))
  positioned.sort((a, b) => {
    const ka = typeof a.el.index === 'string' ? a.el.index : ''
    const kb = typeof b.el.index === 'string' ? b.el.index : ''
    if (ka < kb) return -1
    if (ka > kb) return 1
    return a.i - b.i
  })
  return positioned.map(({ el }) => strip(el))
}
