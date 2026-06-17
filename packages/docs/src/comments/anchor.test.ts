import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import {
  bytesToBase64,
  base64ToBytes,
  encodeRelPos,
  decodeRelPos,
  encodeAnchorAt,
  relPosToIndex,
  ANCHOR_ASSOC_START,
  ANCHOR_ASSOC_END,
} from './anchor.ts'

// The PM<->Y position conversions need a live ySync binding, which isn't available in a unit test;
// these cover the pure-Yjs seams: base64 transport, the assoc the encoder applies, and the orphan
// (null absolute position) path the decoration layer / panel rely on.

describe('anchor base64 <-> bytes transport', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 7, 63])
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes))
  })

  it('round-trips a RelativePosition through base64 (byte-stable, resolves identically)', () => {
    const doc = new Y.Doc()
    const t = doc.getText('t')
    t.insert(0, 'hello world')
    const rel = Y.createRelativePositionFromTypeIndex(t, 6, ANCHOR_ASSOC_START)
    const b64 = encodeRelPos(rel)
    const back = decodeRelPos(b64)
    expect(encodeRelPos(back)).toBe(b64)
    expect(relPosToIndex(back, doc)).toBe(relPosToIndex(rel, doc))
    expect(back.assoc).toBe(ANCHOR_ASSOC_START)
  })
})

describe('association start=+1 / end=-1 (design M3, EXCLUSIVE)', () => {
  it('applies the requested association and preserves it through encode/decode', () => {
    const doc = new Y.Doc()
    const t = doc.getText('t')
    t.insert(0, 'hello world')
    const start = decodeRelPos(encodeAnchorAt(t, 0, ANCHOR_ASSOC_START))
    const end = decodeRelPos(encodeAnchorAt(t, 5, ANCHOR_ASSOC_END))
    expect(start.assoc).toBe(1)
    expect(end.assoc).toBe(-1)
  })
})

describe('orphan handling — null absolute position is a marker, never a throw', () => {
  it('resolves to the original index while the anchored content is present', () => {
    const doc = new Y.Doc()
    const t = doc.getText('t')
    t.insert(0, 'hello')
    const rel = Y.createRelativePositionFromTypeIndex(t, 3, ANCHOR_ASSOC_END)
    expect(relPosToIndex(rel, doc)).toBe(3)
  })

  it('returns null (orphan) when the referenced item is unknown to the doc', () => {
    const docA = new Y.Doc()
    const tA = docA.getText('t')
    tA.insert(0, 'hello')
    const wire = encodeRelPos(Y.createRelativePositionFromTypeIndex(tA, 3, ANCHOR_ASSOC_END))

    const docB = new Y.Doc()
    docB.getText('t') // a fresh doc that never saw docA's item
    expect(() => relPosToIndex(decodeRelPos(wire), docB)).not.toThrow()
    expect(relPosToIndex(decodeRelPos(wire), docB)).toBeNull()
  })

  // Steve's blocking finding: deleting the WHOLE anchored selection does NOT yield a
  // null resolve for either endpoint — both RelativePositions stay resolvable and
  // COLLAPSE onto the same index (from === to). resolveAnchorRange must treat that as
  // an orphan (a root comment is created from a non-empty selection, so a zero-width
  // resolved range means the anchored text is gone) so the panel and the decoration
  // layer agree. This test pins the collapse semantics the orphan check relies on.
  it('anchored selection deleted => both endpoints collapse to the SAME index (not null)', () => {
    const doc = new Y.Doc()
    const t = doc.getText('t')
    t.insert(0, 'foo BAR baz') // "BAR" occupies [4,7)
    const startRel = Y.createRelativePositionFromTypeIndex(t, 4, ANCHOR_ASSOC_START)
    const endRel = Y.createRelativePositionFromTypeIndex(t, 7, ANCHOR_ASSOC_END)

    t.delete(4, 3) // delete "BAR" -> "foo  baz"

    const from = relPosToIndex(startRel, doc)
    const to = relPosToIndex(endRel, doc)
    // Neither endpoint is null — the bug premise: a null-only orphan check would miss this.
    expect(from).not.toBeNull()
    expect(to).not.toBeNull()
    // They collapsed onto the same index => a zero-width range => must be treated as orphan.
    expect(from).toBe(to)
  })
})
