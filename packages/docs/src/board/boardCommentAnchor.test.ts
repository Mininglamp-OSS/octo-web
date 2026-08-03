import { describe, expect, it } from 'vitest'
import { boardElementTypeLabelKey, decodeBoardCommentAnchor, encodeBoardCommentAnchor } from './boardCommentAnchor.ts'

describe('board comment anchors', () => {
  it('round-trips element and point anchors', () => {
    const element = { version: 1, kind: 'element', elementId: 'shape_1', x: 120.5, y: -8 } as const
    const point = { version: 1, kind: 'point', x: 30, y: 40 } as const
    expect(decodeBoardCommentAnchor(encodeBoardCommentAnchor(element))).toEqual(element)
    expect(decodeBoardCommentAnchor(encodeBoardCommentAnchor(point))).toEqual(point)
  })

  it('round-trips a bounded multi-element anchor', () => {
    const anchor = { version: 1, kind: 'element', elementId: 'a', elementIds: ['a', 'b'], x: 1, y: 2 } satisfies import('./boardCommentAnchor.ts').BoardCommentAnchor
    expect(decodeBoardCommentAnchor(encodeBoardCommentAnchor(anchor))).toEqual(anchor)
  })

  it('round-trips UTF-8 element ids and labels without corrupting base64', () => {
    const anchor = { version: 1, kind: 'element', elementId: '形状_🦄', x: 1, y: 2 } as const
    expect(decodeBoardCommentAnchor(encodeBoardCommentAnchor(anchor))).toEqual(anchor)
  })

  it('maps known element types and safely falls back for vendor-added kinds', () => {
    expect(boardElementTypeLabelKey('rectangle')).toBe('docs.board.comment.elementTypes.rectangle')
    expect(boardElementTypeLabelKey('magicframe')).toBe('docs.board.comment.elementTypes.element')
  })

  it('rejects malformed, foreign and unbounded anchors', () => {
    expect(decodeBoardCommentAnchor('not-base64')).toBeNull()
    expect(decodeBoardCommentAnchor(btoa(JSON.stringify({ version: 1, kind: 'cell', x: 1, y: 2 })))).toBeNull()
    expect(decodeBoardCommentAnchor(btoa(JSON.stringify({ version: 1, kind: 'point', x: 1e20, y: 2 })))).toBeNull()
    expect(decodeBoardCommentAnchor(btoa(JSON.stringify({ version: 1, kind: 'element', elementId: 'a', elementIds: ['b'], x: 1, y: 2 })))).toBeNull()
    expect(decodeBoardCommentAnchor(btoa(JSON.stringify({ version: 1, kind: 'element', elementId: 'a b', x: 1, y: 2 })))).toBeNull()
    expect(decodeBoardCommentAnchor(btoa(JSON.stringify({ version: 1, kind: 'point', x: 1, y: 2, extra: true })))).toBeNull()
  })
})
