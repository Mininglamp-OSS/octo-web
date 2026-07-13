// Element ⇆ per-element Y.Map conversion (XIN-16 §1: per-field element storage).
//
// Each element is stored as its OWN `Y.Map<field, value>` inside the top-level `Y.Map('elements')`
// (key = element id). Storing fields individually — rather than the whole element as one opaque
// value — lets the server repair rewrite a single field with a diff-empty check, and lets Yjs
// merge concurrent edits that touch DIFFERENT elements, or different fields of an element that is
// not simultaneously CAS-arbitrated, without clobbering each other.
//
// ⚠️ Merge behaviour is last-writer-wins PER ELEMENT, not lossless field-level merge. The binding
// gates every local element write behind a whole-element CAS on (version, versionNonce) — see
// `binding.ts` `shouldOverwrite` — and `writeElementFields` then rewrites that whole element's
// changed fields. So in the concurrent-edit window two peers editing the SAME element do not each
// keep their own field: the element that wins the version/nonce tie overwrites the loser's fields,
// and the loser's edit is dropped until the next reconcile. Concurrent edits to the same field, or
// to different fields of an element both peers bumped in the same window, therefore resolve LWW.
// The per-field layout is a storage/repair convenience, not a lossless CRDT guarantee.
//
// Unknown-field passthrough (XIN-16 §6 / M-12): we copy *every* own field of the element into the
// Y.Map and read *every* key back out. We never enumerate a known-field allowlist, so a field a
// newer client invents survives a round-trip through an older client untouched.

import * as Y from 'yjs'
import type { ExcalidrawElement, Json } from './types.ts'

/** Deep structural equality for JSON-ish element field values (used by the per-field diff). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false
    return true
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object)
    const bk = Object.keys(b as object)
    if (ak.length !== bk.length) return false
    for (const k of ak) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false
      if (!jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
    }
    return true
  }
  return false
}

/**
 * Deep-clone a JSON-ish element by value. Excalidraw mutates element objects IN PLACE
 * (`mutateElement` reassigns `width`/`height`/`points`/… and bumps `version` on the *same* object)
 * and re-emits those same references to `onChange`. The local diff snapshot must therefore hold a
 * by-value copy, never the live reference — otherwise the next onChange compares the mutated object
 * against itself and the edit is invisible (XIN-80 / XIN-92: only the 0-size create reached the
 * Y.Doc, every later geometry update was diffed away). Mirrors `jsonEqual`'s JSON value model.
 */
export function cloneElement<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => cloneElement(v)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as object)) {
      out[key] = cloneElement((value as Record<string, unknown>)[key])
    }
    return out as T
  }
  return value
}

/** Read a per-element Y.Map back into a plain element object (all fields, unknown included). */
export function readElement(yEl: Y.Map<unknown>): ExcalidrawElement {
  const out: Record<string, unknown> = {}
  yEl.forEach((value, key) => {
    out[key] = value
  })
  return out as unknown as ExcalidrawElement
}

/** Read every element out of the top-level elements map (insertion order is irrelevant — z-order
 *  comes from the `index` field, XIN-16 §1.1).
 *
 *  A remote Yjs update is NOT runtime-typed: a malicious or buggy peer can store a scalar, or a
 *  different shared type (Y.Array/Y.Text), under an element key. `readElement` assumes a Y.Map
 *  (`.forEach`), so before the guard below ONE such entry threw and aborted the entire read — and
 *  since the caller (`binding.applyRemote`) rebuilds the whole scene from this, that single bad
 *  entry blanked every valid peer element (denial-of-render, P1-2). Skip any value that is not a
 *  Y.Map, and defensively catch a per-element read failure, so a malformed entry is dropped rather
 *  than fatal to the batch. */
export function readAllElements(elements: Y.Map<Y.Map<unknown>>): ExcalidrawElement[] {
  const out: ExcalidrawElement[] = []
  elements.forEach((yEl) => {
    // Untrusted-input guard: only per-element Y.Maps are valid element containers.
    if (!(yEl instanceof Y.Map)) return
    try {
      out.push(readElement(yEl))
    } catch {
      // A single malformed element must not abort the batch — drop it and keep the rest.
    }
  })
  return out
}

/**
 * Apply a plain element onto its per-element Y.Map FIELD BY FIELD, writing only the fields that
 * actually changed (the diff-empty guard's per-field arithmetic). Returns the number of mutated
 * fields so the caller can tell whether the transaction did anything at all.
 *
 * MUST be called inside a `ydoc.transact(fn, origin)` so the origin guard works.
 */
export function writeElementFields(yEl: Y.Map<unknown>, el: ExcalidrawElement): number {
  let mutations = 0
  const seen = new Set<string>()
  // Upsert changed / new fields.
  for (const key of Object.keys(el)) {
    const next = (el as Record<string, unknown>)[key]
    if (next === undefined) continue
    seen.add(key)
    if (!yEl.has(key) || !jsonEqual(yEl.get(key), next)) {
      yEl.set(key, next as Json)
      mutations++
    }
  }
  // Drop fields that disappeared from the element (e.g. a binding cleared to undefined).
  for (const key of [...yEl.keys()]) {
    if (!seen.has(key)) {
      yEl.delete(key)
      mutations++
    }
  }
  return mutations
}

/**
 * Create or update an element inside the elements map, field-level. Returns true if any field was
 * written (so the caller knows a transaction was produced). The per-element Y.Map is created
 * lazily on first write.
 */
export function upsertElement(elements: Y.Map<Y.Map<unknown>>, el: ExcalidrawElement): boolean {
  let yEl = elements.get(el.id)
  if (!yEl) {
    yEl = new Y.Map<unknown>()
    elements.set(el.id, yEl)
  }
  return writeElementFields(yEl, el) > 0
}
