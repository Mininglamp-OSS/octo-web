import { describe, it, expect } from 'vitest'
import { cellMatches, parseCell, type SheetCell } from './SheetCommentPanel.tsx'

// Locks the cross-sheet active-thread selection contract: highlighting a thread must match
// the logical sheet id, not just row/col. Regression guard for the panel active-thread path
// (SheetCommentPanel onActiveCell + focusCell effects), the sibling of the overlay ghosting bug.
describe('cellMatches — sheet-scoped active-thread selection', () => {
  const on = (row: number, col: number, sheetId: string): SheetCell => ({ row, col, sheetId })

  it('matches same row/col on the SAME sheet', () => {
    expect(cellMatches(on(5, 3, 'default'), on(5, 3, 'default'))).toBe(true)
  })

  it('does NOT match same row/col on a DIFFERENT sheet (the bug)', () => {
    // A thread anchored to (5,3) on Sheet B must not be selected when you pick (5,3) on Sheet A.
    expect(cellMatches(on(5, 3, 'sheet-b'), on(5, 3, 'default'))).toBe(false)
  })

  it('does not match a different cell on the same sheet', () => {
    expect(cellMatches(on(5, 3, 'default'), on(5, 4, 'default'))).toBe(false)
    expect(cellMatches(on(5, 3, 'default'), on(6, 3, 'default'))).toBe(false)
  })

  it('selects the right thread among same-row/col threads across sheets', () => {
    // Simulate cellByThread: two threads at (5,3) on different sheets; active cell is on sheet-b.
    const cellByThread = new Map<number, SheetCell>([
      [101, on(5, 3, 'default')],
      [202, on(5, 3, 'sheet-b')],
    ])
    const active = on(5, 3, 'sheet-b')
    let picked: number | null = null
    for (const [id, cell] of cellByThread) {
      if (cellMatches(cell, active)) {
        picked = id
        break
      }
    }
    expect(picked).toBe(202)
  })
})

// Locks the legacy V1 anchor normalization contract (P1-2). Pre-V2 single-sheet docs anchored
// comments to the raw Univer sheet id 'octo-sheet-1'; V2 anchors to the stable logical id 'default'.
// parseCell must rewrite the legacy id on decode so old comments still resolve to their cell —
// otherwise cellMatches / marker filtering never match ('octo-sheet-1' !== 'default') and every
// legacy comment silently loses its badge, highlight, and click-to-focus.
describe('parseCell — legacy V1 anchor normalization', () => {
  const enc = (sheetId: string, row: number, col: number) => btoa(`${sheetId}!${row}:${col}`)

  it('normalizes legacy octo-sheet-1 anchors to the default logical id', () => {
    expect(parseCell(enc('octo-sheet-1', 5, 3))).toEqual({ row: 5, col: 3, sheetId: 'default' })
  })

  it('leaves V2 default anchors untouched', () => {
    expect(parseCell(enc('default', 5, 3))).toEqual({ row: 5, col: 3, sheetId: 'default' })
  })

  it('leaves other V2 sheet ids untouched', () => {
    expect(parseCell(enc('sheet-xyz', 2, 4))).toEqual({ row: 2, col: 4, sheetId: 'sheet-xyz' })
  })

  it('a normalized legacy anchor now matches a default-sheet cell selection', () => {
    const legacy = parseCell(enc('octo-sheet-1', 5, 3))!
    // Selecting (5,3) on the (logical) default sheet must highlight the migrated legacy thread.
    expect(cellMatches(legacy, { row: 5, col: 3, sheetId: 'default' })).toBe(true)
  })

  it('returns null for non-cell / malformed anchors', () => {
    expect(parseCell(null)).toBeNull()
    expect(parseCell('')).toBeNull()
    expect(parseCell(btoa('default!x:y'))).toBeNull()
    expect(parseCell(btoa('no-bang-segment'))).toBeNull()
  })
})
