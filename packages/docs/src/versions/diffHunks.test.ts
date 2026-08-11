// Hunk grouping + line numbering (versions/diffHunks.ts).
//
// The two properties worth pinning, because both are things the PROTOTYPE gets wrong and a future
// refactor could easily regress back into:
//   1. the BEFORE and AFTER line numbers advance INDEPENDENTLY (the prototype hard-codes
//      newStart = oldStart, which is only right when block counts never diverge), and
//   2. a run of consecutive changes is ONE hunk, with real unchanged neighbours as context — not one
//      card per changed block, and not a section title standing in for a context line.

import { describe, it, expect } from 'vitest'
import type { DiffEntry } from './diff.ts'
import { toHunks, CONTEXT_LINES } from './diffHunks.ts'

const un = (text: string): DiffEntry => ({ type: 'unchanged', text })
const add = (text: string): DiffEntry => ({ type: 'added', text })
const rem = (text: string): DiffEntry => ({ type: 'removed', text })
const chg = (before: string, after: string): DiffEntry => ({ type: 'changed', before, after })

describe('toHunks — nothing to show', () => {
  it('returns no hunks for an empty diff', () => {
    expect(toHunks([])).toEqual([])
  })

  it('returns no hunks when every entry is unchanged', () => {
    expect(toHunks([un('a'), un('b')])).toEqual([])
  })

  it('returns no hunks for the too-large sentinel (the caller renders its own notice)', () => {
    expect(toHunks([{ type: 'too-large' }])).toEqual([])
  })
})

describe('toHunks — line numbering', () => {
  it('advances both sides on a changed entry and pairs it as one - then one + row', () => {
    const [hunk] = toHunks([un('l1'), chg('old', 'new'), un('l3')])
    // context(1,1) → removed(2,null) → added(null,2) → context(3,3)
    expect(hunk.lines.map((l) => [l.type, l.oldNumber, l.newNumber])).toEqual([
      ['context', 1, 1],
      ['removed', 2, null],
      ['added', null, 2],
      ['context', 3, 3],
    ])
  })

  it('advances ONLY the old side for a deletion, so the after column stays truthful', () => {
    const [hunk] = toHunks([un('keep'), rem('gone'), un('tail')])
    expect(hunk.lines.map((l) => [l.type, l.oldNumber, l.newNumber])).toEqual([
      ['context', 1, 1],
      ['removed', 2, null],
      // The trailing context is line 3 BEFORE but line 2 AFTER — the divergence the prototype's
      // newStart = oldStart shortcut cannot express.
      ['context', 3, 2],
    ])
  })

  it('advances ONLY the new side for an insertion', () => {
    const [hunk] = toHunks([un('keep'), add('fresh'), un('tail')])
    expect(hunk.lines.map((l) => [l.type, l.oldNumber, l.newNumber])).toEqual([
      ['context', 1, 1],
      ['added', null, 2],
      ['context', 2, 3],
    ])
  })

  it('keeps the two counters diverged across several hunks', () => {
    // 2 deletions before the second change ⇒ AFTER runs two lines behind BEFORE.
    const hunks = toHunks([un('a'), rem('b'), rem('c'), un('d'), un('e'), un('f'), chg('g', 'G')])
    expect(hunks).toHaveLength(2)
    const last = hunks[1].lines.find((l) => l.type === 'removed')
    // 'g' is the 7th BEFORE line but only the 5th AFTER line.
    expect(last?.oldNumber).toBe(7)
    const added = hunks[1].lines.find((l) => l.type === 'added')
    expect(added?.newNumber).toBe(5)
  })
})

describe('toHunks — grouping', () => {
  it('merges a run of consecutive changes into ONE hunk', () => {
    const hunks = toHunks([un('a'), rem('b'), add('c'), chg('d', 'D'), un('e')])
    expect(hunks).toHaveLength(1)
    expect(hunks[0].removedCount).toBe(2) // rem('b') + the '-' half of chg
    expect(hunks[0].addedCount).toBe(2) // add('c') + the '+' half of chg
  })

  it('splits into separate hunks when unchanged blocks separate the changes', () => {
    const hunks = toHunks([chg('a', 'A'), un('x'), un('y'), un('z'), chg('b', 'B')])
    expect(hunks).toHaveLength(2)
    expect(hunks.map((h) => h.index)).toEqual([1, 2])
  })

  it(`keeps ${CONTEXT_LINES} unchanged row of context on each side and DROPS distant ones`, () => {
    const hunks = toHunks([un('far1'), un('far2'), un('near'), chg('a', 'A'), un('after'), un('far3')])
    const texts = hunks[0].lines.map((l) => l.text)
    expect(texts).toContain('near')
    expect(texts).toContain('after')
    // The point of the view is "what changed": remote unchanged blocks are not rendered at all.
    expect(texts).not.toContain('far1')
    expect(texts).not.toContain('far2')
    expect(texts).not.toContain('far3')
  })

  it('handles a change at the very start of the document (no leading context)', () => {
    const [hunk] = toHunks([add('first'), un('second')])
    expect(hunk.lines[0].type).toBe('added')
    expect(hunk.oldStart).toBe(1) // no BEFORE number on row 0 → falls back, never undefined
    expect(hunk.newStart).toBe(1)
  })

  it('handles a change at the very end (no trailing context)', () => {
    const [hunk] = toHunks([un('a'), rem('b')])
    expect(hunk.lines.at(-1)?.type).toBe('removed')
  })
})
