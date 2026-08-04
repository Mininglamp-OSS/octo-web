import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import { cellMatches, parseCell, SheetCommentPanel, type SheetCell } from './SheetCommentPanel.tsx'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import type { UseDocComments } from '../comments/useDocComments.ts'
import type { CommentThread } from '../comments/api.ts'
import type { CommentMutationResult } from '../comments/useDocComments.ts'
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
    loadingThreadIds: new Set(),
    error: null,
    nextCursor: null,
    includeResolved: false,
    setIncludeResolved: () => {},
    refresh: async () => {},
    loadMore: async () => {},
    loadThread: async () => true,
    createRoot: async () => ({ ok: true, error: null }),
    reply: async () => ({ ok: true, error: null }),
    editBody: async () => ({ ok: true, error: null }),
    resolve: async () => ({ ok: true, error: null }),
    remove: async () => ({ ok: true, error: null }),
    ...overrides,
  }
}

const failed = (error: string): CommentMutationResult => ({ ok: false, error })

function commentThread(id: number, resolved = false): CommentThread {
  const cell = `default!${id - 1}:0`
  return {
    id,
    docId: 'doc-1',
    parentId: null,
    authorUid: 'u_self',
    body: `comment ${id}`,
    anchorStart: btoa(cell),
    anchorEnd: btoa(cell),
    anchorText: `A${id}`,
    resolved,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    replies: [],
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

function renderPanel(
  sheet: CollabSheet | null,
  comments: UseDocComments = makeComments(),
  role: 'reader' | 'commenter' | 'writer' | 'admin' = 'commenter',
) {
  return render(
    createElement(SheetCommentPanel, {
      docId: 'doc-1',
      sheet,
      role,
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
    // …and the composer is hidden until the user clicks the entry button.
    expect(document.querySelector('.octo-mention-composer')).toBeNull()
  })

  it('reveals the composer + submit button when the entry button is clicked', () => {
    renderPanel(makeSheet({ key: 'default!0:0', a1: 'A1', sheetId: 'default' }))
    fireEvent.click(screen.getByRole('button', { name: /docs\.comment\.commentButton/ }))
    // The rich MentionComposer now renders (replaced the plain <textarea> when @-mention landed;
    // it exposes the same octo-comment-input surface via a contenteditable, plus the mention class).
    expect(document.querySelector('.octo-mention-composer')).not.toBeNull()
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

// Four-role comment matrix (feat: enforce commenter role). reader may VIEW threads but has no
// write entry (no root-compose button, no reply); commenter/writer/admin may compose + reply;
// resolve/reopen stays writer/admin. Mirrors the doc + board panels.
describe('SheetCommentPanel — four-role permission matrix', () => {
  beforeEach(() => {
    setWKApp(createMockWKApp())
  })
  afterEach(() => cleanup())

  const sheet = () => makeSheet({ key: 'default!0:0', a1: 'A1', sheetId: 'default' })

  it('reader: no compose entry and no reply button (view-only), thread still rendered', () => {
    renderPanel(sheet(), makeComments({ threads: [commentThread(1)] }), 'reader')
    expect(screen.queryByRole('button', { name: /docs\.comment\.commentButton/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /docs\.comment\.reply/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /docs\.comment\.resolve/ })).toBeNull()
    // The comment body is still visible — reader can read.
    expect(screen.getByText('comment 1')).toBeTruthy()
  })

  it('commenter: compose entry + reply present, but no resolve/reopen (cannot edit body)', () => {
    renderPanel(sheet(), makeComments({ threads: [commentThread(1)] }), 'commenter')
    expect(screen.getByRole('button', { name: /docs\.comment\.commentButton/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /docs\.comment\.reply/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /docs\.comment\.resolve/ })).toBeNull()
  })

  // Body-edit is writer-level (PATCH contract = author + writer); a commenter author keeps delete.
  it('commenter author: no edit button on own comment, but delete stays', () => {
    renderPanel(sheet(), makeComments({ threads: [commentThread(1)] }), 'commenter')
    expect(screen.queryByRole('button', { name: /docs\.comment\.edit/ })).toBeNull()
    expect(screen.getByRole('button', { name: /docs\.comment\.delete/ })).toBeTruthy()
  })

  it('writer author: edit + delete both present on own comment', () => {
    renderPanel(sheet(), makeComments({ threads: [commentThread(1)] }), 'writer')
    expect(screen.getByRole('button', { name: /docs\.comment\.edit/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /docs\.comment\.delete/ })).toBeTruthy()
  })

  // Backend #147: DELETE requires the commenter floor, so a reader author must not see soft-delete.
  it('reader author: no delete button (soft-delete needs commenter floor)', () => {
    renderPanel(sheet(), makeComments({ threads: [commentThread(1)] }), 'reader')
    expect(screen.queryByRole('button', { name: /docs\.comment\.delete/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /docs\.comment\.edit/ })).toBeNull()
  })

  it('admin author: own delete stays soft', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const remove = vi.fn(async () => ({ ok: true, error: null }))
    renderPanel(sheet(), makeComments({ threads: [commentThread(1)], remove }), 'admin')
    fireEvent.click(screen.getByRole('button', { name: /docs\.comment\.delete/ }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(1, false))
  })

  for (const role of ['writer', 'admin'] as const) {
    it(`${role}: compose entry + reply + resolve all present`, () => {
      renderPanel(sheet(), makeComments({ threads: [commentThread(1)] }), role)
      expect(screen.getByRole('button', { name: /docs\.comment\.commentButton/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /docs\.comment\.reply/ })).toBeTruthy()
      expect(screen.getByRole('button', { name: /docs\.comment\.resolve/ })).toBeTruthy()
    })
  }
})

// Runtime downgrade fail-closed: an open reply/edit composer + the root compose must close when
// the role drops, so a stale closure can never submit after commenter->reader / writer->commenter.
describe('SheetCommentPanel — runtime downgrade closes open composers', () => {
  beforeEach(() => {
    setWKApp(createMockWKApp())
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => cleanup())

  const cell = () => makeSheet({ key: 'default!0:0', a1: 'A1', sheetId: 'default' })

  it('commenter->reader closes an open reply composer', () => {
    const { rerender } = renderPanel(cell(), makeComments({ threads: [commentThread(1)] }), 'commenter')
    fireEvent.click(screen.getByRole('button', { name: /docs\.comment\.reply/ }))
    expect(document.querySelector('.octo-mention-composer')).not.toBeNull()
    rerender(
      createElement(SheetCommentPanel, {
        docId: 'doc-1',
        sheet: cell(),
        role: 'reader',
        comments: makeComments({ threads: [commentThread(1)] }),
      }),
    )
    expect(screen.queryByRole('button', { name: /docs\.comment\.reply/ })).toBeNull()
    expect(document.querySelector('.octo-mention-composer')).toBeNull()
  })

  it('writer->commenter closes an open edit composer on own comment', () => {
    const { rerender } = renderPanel(cell(), makeComments({ threads: [commentThread(1)] }), 'writer')
    fireEvent.click(screen.getByRole('button', { name: /docs\.comment\.edit/ }))
    expect(screen.getByRole('button', { name: /docs\.comment\.save/ })).toBeTruthy()
    rerender(
      createElement(SheetCommentPanel, {
        docId: 'doc-1',
        sheet: cell(),
        role: 'commenter',
        comments: makeComments({ threads: [commentThread(1)] }),
      }),
    )
    expect(screen.queryByRole('button', { name: /docs\.comment\.save/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /docs\.comment\.edit/ })).toBeNull()
  })
})

describe('SheetCommentPanel — mutation failures', () => {
  beforeEach(() => {
    setWKApp(createMockWKApp())
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => cleanup())

  it('renders delete and resolve/reopen failures as alerts beside only the affected rows', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const remove = vi.fn(async () => failed('Delete A1 failed.'))
    const resolve = vi.fn(async (id: number, resolved: boolean) =>
      failed(`${resolved ? 'Resolve' : 'Reopen'} A${id} failed.`),
    )
    renderPanel(
      makeSheet({ key: 'default!0:0', a1: 'A1', sheetId: 'default' }),
      makeComments({ threads: [commentThread(1), commentThread(2), commentThread(3, true)], remove, resolve }),
      'writer',
    )

    const row1 = screen.getByText('A1').closest('li')!
    const row2 = screen.getByText('A2').closest('li')!
    const row3 = screen.getByText('A3').closest('li')!

    fireEvent.click(within(row1).getByRole('button', { name: 'docs.comment.delete' }))
    expect((await within(row1).findByRole('alert')).textContent).toBe('Delete A1 failed.')
    expect(within(row2).queryByRole('alert')).toBeNull()
    expect(within(row3).queryByRole('alert')).toBeNull()

    fireEvent.click(within(row2).getByRole('button', { name: 'docs.comment.resolve' }))
    await waitFor(() => expect(within(row2).getByRole('alert').textContent).toBe('Resolve A2 failed.'))
    expect(within(row1).getByRole('alert').textContent).toBe('Delete A1 failed.')
    expect(within(row3).queryByRole('alert')).toBeNull()

    fireEvent.click(within(row3).getByRole('button', { name: 'docs.comment.reopen' }))
    await waitFor(() => expect(within(row3).getByRole('alert').textContent).toBe('Reopen A3 failed.'))
    expect(resolve).toHaveBeenCalledWith(2, true)
    expect(resolve).toHaveBeenCalledWith(3, false)
  })
})
