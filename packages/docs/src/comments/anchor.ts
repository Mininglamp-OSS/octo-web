// Comment anchoring — Yjs RelativePosition + ProseMirror Decoration (feature #3 §, design M3).
//
// A comment root anchors to a text RANGE [from,to] in the live doc. We store that range as TWO
// Yjs RelativePositions (base64-encoded) on the backend, NOT raw ProseMirror offsets: a relative
// position rides along with concurrent edits, so the highlight stays on the same words even after
// other users insert/delete text elsewhere.
//
// ASSOCIATION (design M3, validated start=+1 / end=-1, EXCLUSIVE):
//   - the START anchor uses assoc +1 — it sticks to the character AFTER it,
//   - the END anchor uses assoc -1 — it sticks to the character BEFORE it,
// so the highlight grows/shrinks correctly at its boundaries and does not swallow text typed
// immediately outside the range.
//
// ENCODE APPROACH (documented, since the ySync binding gives us no assoc-aware seam directly):
// `absolutePositionToRelativePosition(pos, type, mapping)` is the robust way to
// turn a ProseMirror absolute position into the right Yjs (type, index) — but it hard-codes assoc
// -1 internally and returns a finished RelativePosition. We cannot simply flip `.assoc` on that
// object, because `Y.createRelativePositionFromTypeIndex` resolves a *different anchor item*
// depending on assoc (for assoc<0 it decrements the index and binds to the left item). So instead
// we (1) get the assoc(-1) relpos from the binding, (2) resolve it back to a concrete Yjs
// {type, index} via `Y.createAbsolutePositionFromRelativePosition` — Yjs guarantees this round-trip
// returns the original index — and (3) re-create the relpos at that exact (type, index) with the
// assoc we actually want. Public APIs only, no tree-walking re-implementation.
//
// DECODE: base64 -> bytes -> `Y.decodeRelativePosition` -> `relativePositionToAbsolutePosition`
// back to a ProseMirror position. A null result means the anchored content was
// deleted => ORPHAN: we never throw, the caller renders the comment from its `anchorText` snapshot.
//
// BINDING SOURCE: Tiptap v3's Collaboration extension binds the Y.Doc via @tiptap/y-tiptap (its
// own y-prosemirror fork). We read `ySyncPluginKey` and the abs<->rel position helpers from
// @tiptap/y-tiptap so the PluginKey and the PM<->Y mapping match the live editor's binding — the
// standalone y-prosemirror package registers a different key and would return a null state here.

import * as Y from 'yjs'
import type { Editor } from '@tiptap/core'
import {
  ySyncPluginKey,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from '@tiptap/y-tiptap'

/** START sticks to the char AFTER the anchor (design M3). */
export const ANCHOR_ASSOC_START = 1
/** END sticks to the char BEFORE the anchor (design M3). */
export const ANCHOR_ASSOC_END = -1
/** Cap for the plain-text snapshot sent on create (orphan fallback). */
export const ANCHOR_TEXT_MAX = 512

// --- base64 <-> bytes (RelativePosition serialises to a Uint8Array) -----------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function encodeRelPos(relPos: Y.RelativePosition): string {
  return bytesToBase64(Y.encodeRelativePosition(relPos))
}

export function decodeRelPos(b64: string): Y.RelativePosition {
  return Y.decodeRelativePosition(base64ToBytes(b64))
}

/**
 * Encode a single Yjs (type, index) as a base64 RelativePosition with the given association.
 * Pure over Yjs primitives so it's unit-testable with a constructed Y.Doc/type. The high-level
 * editor path passes ANCHOR_ASSOC_START for the range start and ANCHOR_ASSOC_END for the end.
 */
// the binding's typings (ProsemirrorMapping, XmlFragment) are looser than ours at this boundary;
// we keep our own surface typed and cast only where we hand values to those untyped library fns.
/* eslint-disable @typescript-eslint/no-explicit-any */

export function encodeAnchorAt(
  type: Y.AbstractType<any>,
  index: number,
  assoc: number,
): string {
  return encodeRelPos(Y.createRelativePositionFromTypeIndex(type, index, assoc))
}

/**
 * Resolve a decoded RelativePosition back to a concrete Yjs index, or null when the anchored
 * content is gone (ORPHAN). Pure over Yjs primitives — the orphan path is exercised by decoding a
 * position from one doc against another that has never seen the referenced item.
 */
export function relPosToIndex(relPos: Y.RelativePosition, ydoc: Y.Doc): number | null {
  const abs = Y.createAbsolutePositionFromRelativePosition(relPos, ydoc)
  return abs == null ? null : abs.index
}

// --- editor-bound binding seam ------------------------------------------------------------------

interface YBinding {
  ydoc: Y.Doc
  type: Y.XmlFragment
  // the binding's ProsemirrorMapping (Map<Y.AbstractType, Node | Node[]>); opaque to us.
  mapping: any
}

/** Pull the live ySync binding (root type + PM<->Y mapping) out of the editor, or null if not yet bound. */
export function getYBinding(editor: Editor): YBinding | null {
  const state = ySyncPluginKey.getState(editor.state) as
    | { type?: Y.XmlFragment; doc?: Y.Doc; binding?: { mapping: any } }
    | undefined
  if (!state || !state.type || !state.doc || !state.binding) return null
  return { ydoc: state.doc, type: state.type, mapping: state.binding.mapping }
}

/** Resolve a ProseMirror absolute position to a concrete Yjs {type, index} (see file header). */
function pmPosToYAbs(b: YBinding, pmPos: number): Y.AbsolutePosition | null {
  const base = absolutePositionToRelativePosition(pmPos, b.type, b.mapping)
  return Y.createAbsolutePositionFromRelativePosition(base, b.ydoc)
}

export interface EncodedAnchor {
  anchorStart: string
  anchorEnd: string
  anchorText: string
}

/**
 * Encode a ProseMirror range [from,to] into the wire anchors for a root comment. Returns null when
 * the range can't be mapped into the Yjs model (e.g. binding not ready). `from`/`to` are normalised.
 */
export function encodeAnchorRange(editor: Editor, from: number, to: number): EncodedAnchor | null {
  const b = getYBinding(editor)
  if (!b) return null
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const a = pmPosToYAbs(b, lo)
  const c = pmPosToYAbs(b, hi)
  if (!a || !c) return null
  return {
    anchorStart: encodeAnchorAt(a.type, a.index, ANCHOR_ASSOC_START),
    anchorEnd: encodeAnchorAt(c.type, c.index, ANCHOR_ASSOC_END),
    anchorText: anchorTextSnapshot(editor, lo, hi),
  }
}

/** Short plain-text snapshot of the anchored range (≤ ANCHOR_TEXT_MAX), for orphaned comments. */
export function anchorTextSnapshot(editor: Editor, from: number, to: number): string {
  const text = editor.state.doc.textBetween(Math.min(from, to), Math.max(from, to), ' ', ' ')
  return text.length > ANCHOR_TEXT_MAX ? text.slice(0, ANCHOR_TEXT_MAX) : text
}

export interface ResolvedRange {
  from: number
  to: number
}

/**
 * Resolve a stored anchor (decoded RelativePositions) back to a live ProseMirror range, or null if
 * either end is orphaned. Used by the decoration layer and by "scroll to highlight".
 */
export function resolveAnchorRange(
  editor: Editor,
  startRel: Y.RelativePosition,
  endRel: Y.RelativePosition,
): ResolvedRange | null {
  const b = getYBinding(editor)
  if (!b) return null
  const from = relativePositionToAbsolutePosition(b.ydoc, b.type, startRel, b.mapping)
  const to = relativePositionToAbsolutePosition(b.ydoc, b.type, endRel, b.mapping)
  if (from == null || to == null) return null // ORPHAN — anchored content was deleted.
  // ORPHAN (collapsed): a root comment is always created from a NON-empty selection,
  // so a zero-width resolved range means the anchored text was deleted and the two
  // RelativePositions collapsed onto the same index (Yjs does NOT return null in this
  // case — both relpos still resolve, to the same point). Treat it as an orphan so the
  // panel and the decoration layer agree: no highlight is painted (CommentDecorations
  // already skips lo>=hi), and the panel must NOT show it as a live anchor with a stale
  // quote / scroll target. Returning null here routes it through the same orphan path
  // as a null resolve (rendered from the anchorText snapshot).
  if (from === to) return null
  return from < to ? { from, to } : { from: to, to: from }
}
