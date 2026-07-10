/**
 * @octo/whiteboard-schema — element normalize rule set (XIN-16 §1/§4/§6).
 *
 * `normalizeElement` is the SINGLE shared rule definition the front-end binding
 * (local, render-time defence) and the back-end authoritative repair both call.
 * The only difference between the two sides is WHO may write the result back
 * (§4: server authoritative only); the rules themselves are identical here, so
 * the two sides never normalize to different shapes and fight each other.
 *
 * The function is PURE and DETERMINISTIC: same input element (+ same context) =>
 * same output, with no randomness and no clock reads. This is a precondition of
 * BE-M11 (cross-instance byte-identical repair) — any randomness here (e.g. a
 * random versionNonce fill) would make independent repairs diverge.
 *
 * Per-element scope (by design): version / versionNonce / numeric clamps / type
 * + id validation / dangling-ref pruning. Fractional-index REASSIGNMENT needs
 * the whole element set and is therefore completed by repair (repairElements),
 * not here — normalize only strips an invalid index to a clean absent state.
 */
import { WB_ELEMENT_TYPES, FILE_BEARING_TYPES } from './constants.ts'
import type { WhiteboardElement, NormalizeContext } from './types.ts'

/**
 * Fractional-index (order key) validity — cross-repo contract (XIN-794/795).
 *
 * Excalidraw's `index` is a jitterbug / fractional-indexing order key, NOT just
 * any base62 string. The old rule `/^[A-Za-z0-9]+$/` only checked the character
 * set, so a synthetic key like `r00000003` (produced by a since-fixed BE repair)
 * passed as valid, reached `updateScene`, and crashed the canvas — the head 'r'
 * declares a 19-char integer part but the key is 9 chars, so the real library
 * rejects it. The rules below replicate `fractional-indexing`'s `validateOrderKey`
 * as a pure boolean (no throw, no runtime dependency), so the FE binding, the BE
 * authoritative repair, and the Agent path all agree byte-for-byte on legality.
 *
 * A key is valid iff ALL hold:
 *   1. non-empty and every char is in the base62 alphabet below;
 *   2. it is not the reserved SMALLEST_INTEGER sentinel;
 *   3. the head char is 'a'..'z' or 'A'..'Z' AND the integer-part length it
 *      declares (2..27) fits inside the key;
 *   4. the fractional part (everything after the integer part) does not end in
 *      the first digit ('0').
 */
const BASE62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE62_RE = /^[0-9A-Za-z]+$/
const SMALLEST_INTEGER = 'A00000000000000000000000000'

/**
 * Integer-part length encoded by an order key's head char (jitterbug):
 * 'a'..'z' -> 2..27 and 'A'..'Z' -> 27..2. Any other head is illegal.
 * Mirrors fractional-indexing `getIntegerLength`; returns 0 for an illegal head.
 */
function orderKeyIntegerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 97 + 2
  if (head >= 'A' && head <= 'Z') return 90 - head.charCodeAt(0) + 2
  return 0
}

/** Structural validity of a fractional-index key (see contract above). */
function isValidOrderKey(key: string): boolean {
  if (key.length === 0 || !BASE62_RE.test(key)) return false
  if (key === SMALLEST_INTEGER) return false
  const intLen = orderKeyIntegerLength(key.charAt(0))
  if (intLen === 0 || intLen > key.length) return false
  const fraction = key.slice(intLen)
  if (fraction.slice(-1) === BASE62_DIGITS[0]) return false
  return true
}

/** Known numeric fields clamped to finite values; opacity additionally [0,100]. */
const FINITE_FIELDS = ['x', 'y', 'width', 'height', 'angle', 'strokeWidth', 'fontSize'] as const
const NON_NEGATIVE_FIELDS = new Set<string>(['width', 'height', 'strokeWidth', 'fontSize'])

/**
 * Deterministic 32-bit FNV-1a hash of a string, masked to a non-negative int.
 * Used to fill a missing/invalid `versionNonce` WITHOUT randomness so repair is
 * reproducible across instances.
 */
export function deterministicNonce(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    // FNV prime multiply via shifts (stay in 32-bit via >>> 0).
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h & 0x7fffffff
}

/** True if `v` is a structurally valid fractional-index (order) key. */
export function isValidIndex(v: unknown): v is string {
  return typeof v === 'string' && isValidOrderKey(v)
}

function coerceVersion(v: unknown): number {
  return Number.isInteger(v) && (v as number) >= 1 ? (v as number) : 1
}

/**
 * Normalize a single element to canonical form, or return `null` if the element
 * is unrenderable and must be dropped (missing/blank id, non-string or
 * unknown-whitelist `type`, or — when `ctx.fileIds` is supplied — an image whose
 * `fileId` points at a file not present in the `files` container, §2).
 *
 * Unknown fields are preserved verbatim (§6). The input is never mutated.
 */
export function normalizeElement(
  el: unknown,
  ctx: NormalizeContext = {},
): WhiteboardElement | null {
  if (!el || typeof el !== 'object') return null
  const src = el as Record<string, unknown>
  if (typeof src.id !== 'string' || src.id.length === 0) return null
  if (typeof src.type !== 'string' || !WB_ELEMENT_TYPES.has(src.type)) return null

  // Clone (preserve unknown fields, §6); then correct known fields in place.
  const out: Record<string, unknown> = { ...src }

  const version = coerceVersion(src.version)
  out.version = version
  out.versionNonce = Number.isInteger(src.versionNonce)
    ? (src.versionNonce as number)
    : deterministicNonce(`${src.id}:${version}`)

  if ('isDeleted' in src) out.isDeleted = src.isDeleted === true

  // Numeric clamps: NaN/Infinity -> 0; non-negative fields floored at 0;
  // opacity clamped to [0,100].
  for (const f of FINITE_FIELDS) {
    if (f in out) {
      const n = typeof out[f] === 'number' && Number.isFinite(out[f]) ? (out[f] as number) : 0
      out[f] = NON_NEGATIVE_FIELDS.has(f) ? Math.max(0, n) : n
    }
  }
  if ('opacity' in out) {
    const o = typeof out.opacity === 'number' && Number.isFinite(out.opacity) ? out.opacity : 100
    out.opacity = Math.min(100, Math.max(0, o))
  }

  // Invalid/missing fractional index -> clean absent state; repairElements
  // assigns a deterministic key to indexless elements across the whole set.
  if (!isValidIndex(out.index)) delete out.index

  // Prune dangling references when context is supplied (§4.1).
  if (ctx.elementIds) {
    if (Array.isArray(out.boundElements)) {
      out.boundElements = (out.boundElements as Array<{ id?: unknown }>).filter(
        (b) => b && typeof b.id === 'string' && ctx.elementIds!.has(b.id),
      )
    }
    if (typeof out.frameId === 'string' && !ctx.elementIds.has(out.frameId)) {
      out.frameId = null
    }
    // A bound text whose container element was deleted is orphaned: clear the
    // dangling `containerId` (M-5). Same shape as the `frameId` rule above —
    // a ref to a non-surviving element is set to null, never deleted.
    if (typeof out.containerId === 'string' && !ctx.elementIds.has(out.containerId)) {
      out.containerId = null
    }
  }
  if (ctx.fileIds && FILE_BEARING_TYPES.has(src.type)) {
    // Image with a dangling file reference is unrenderable -> drop (§2.3).
    if (typeof src.fileId !== 'string' || !ctx.fileIds.has(src.fileId)) return null
  }

  return out as WhiteboardElement
}

/**
 * CAS arbitration (§1.1): does `incoming` supersede `current`?
 *   - higher `version` wins;
 *   - equal version -> smaller `versionNonce` wins;
 *   - otherwise treated as same state -> false (no write).
 * `current === undefined` (no existing element) => incoming wins.
 */
export function elementSupersedes(
  current: Pick<WhiteboardElement, 'version' | 'versionNonce'> | undefined,
  incoming: Pick<WhiteboardElement, 'version' | 'versionNonce'>,
): boolean {
  if (!current) return true
  if (incoming.version !== current.version) return incoming.version > current.version
  if (incoming.versionNonce !== current.versionNonce) return incoming.versionNonce < current.versionNonce
  return false
}
