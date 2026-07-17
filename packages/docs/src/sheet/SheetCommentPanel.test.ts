import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createElement } from 'react'
import { cellMatches, parseCell, SheetCommentPanel, type SheetCell } from './SheetCommentPanel.tsx'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import type { UseDocComments } from '../comments/useDocComments.ts'
import type { CollabSheet } from './CollabSheet.ts'

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

// ---------------------------------------------------------------------------
// Compose entry-button + selection-label UX (XIN-1337).
//
// The sheet panel used to render the compose textarea and a `!body.trim()`-locked submit
// button up-front, so the only visible control read as a permanently-disabled button. The
// fix mirrors the doc CommentBubble two-step interaction: an always-visible, always-clickable
// entry button that reveals the composer on click. These render tests lock (1) the entry
// button is present and clickable before composing, (2) clicking it reveals the composer,
// and (3) the submit label reflects the selected cell ("Comment A1") rather than the generic
// "current cell" label, seeded from the live selection on mount.
// ---------------------------------------------------------------------------

function makeComments(overrides: Partial<UseDocComments> = {}): UseDocComments {
  return {
    threads: [],
    loading: false,
    error: null,
    nextCursor: null,
    includeResolved: false,
    setIncludeResolved: () => {},
    refresh: async () => {},
    loadMore: async () => {},
    createRoot: async () => {},
    reply: async () => {},
    editBody: async () => {},
    resolve: async () => {},
    remove: async () => {},
    ...overrides,
  }
}

function makeSheet(activeCell: { key: string; a1: string; sheetId: string } | null): CollabSheet {
  return {
    getActiveCellRef: () => activeCell,
    onActiveCell: () => () => {},
    focusCell: () => {},
    setCommentedCells: () => {},
  } as unknown as CollabSheet
}

function renderPanel(sheet: CollabSheet | null, comments: UseDocComments = makeComments()) {
  return render(
    createElement(SheetCommentPanel, {
      docId: 'doc-1',
      sheet,
      role: 'reader' as const,
      comments,
    }),
  )
}

describe('SheetCommentPanel — compose entry button (XIN-1337)', () => {
  beforeEach(() => {
    setWKApp(createMockWKApp())
  })
  afterEach(() => cleanup())

  it('shows an always-clickable entry button, not the compose box, before composing', () => {
    renderPanel(makeSheet({ key: 'default!0:0', a1: 'A1', sheetId: 'default' }))
    // Entry button (mirrors CommentBubble: "💬 <commentButton>") is present and NOT disabled…
    const entry = screen.getByRole('button', { name: /docs\.comment\.commentButton/ }) as HTMLButtonElement
    expect(entry).toBeTruthy()
    expect(entry.disabled).toBe(false)
    // …and the composer textarea is hidden until the user clicks it.
    expect(document.querySelector('textarea.octo-comment-input')).toBeNull()
  })

  it('reveals the composer + submit button when the entry button is clicked', () => {
    renderPanel(makeSheet({ key: 'default!0:0', a1: 'A1', sheetId: 'default' }))
    fireEvent.click(screen.getByRole('button', { name: /docs\.comment\.commentButton/ }))
    // The composer now renders…
    expect(document.querySelector('textarea.octo-comment-input')).not.toBeNull()
    // …and the submit button appears, disabled while the body is empty (spam guard kept).
    const submit = screen.getByRole('button', { name: /docs\.sheet\.comment\.menu A1/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('disables the entry button while the sheet is not connected', () => {
    renderPanel(null)
    const entry = screen.getByRole('button', { name: /docs\.comment\.commentButton/ }) as HTMLButtonElement
    expect(entry.disabled).toBe(true)
  })

  it('submit label reads "Comment A1" when a cell is selected (seeded from live selection)', () => {
    renderPanel(makeSheet({ key: 'default!4:2', a1: 'C5', sheetId: 'default' }))
    fireEvent.click(screen.getByRole('button', { name: /docs\.comment\.commentButton/ }))
    // Seeded on mount from getActiveCellRef → label carries the A1 ref, not the generic fallback.
    expect(screen.getByRole('button', { name: /docs\.sheet\.comment\.menu C5/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /docs\.sheet\.comment\.current/ })).toBeNull()
  })

  it('falls back to the generic "current cell" label when no cell is selected', () => {
    renderPanel(makeSheet(null))
    fireEvent.click(screen.getByRole('button', { name: /docs\.comment\.commentButton/ }))
    expect(screen.getByRole('button', { name: /docs\.sheet\.comment\.current/ })).toBeTruthy()
  })
})
