import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import type { CollabSheet } from './CollabSheet.ts'

// XIN-842: the sheet SheetVersionPanel is now a THIN ADAPTER over the unified <VersionHistoryPanel>.
// The shell's own behavior (list / filter / counts / load-more, the preview modal machine, race
// guard, mutations, role gating) is pinned by VersionHistoryPanel.test.tsx. These tests pin only
// the sheet-specific wiring the adapter injects: it renders the shell as a single mixed list, loads
// a preview via getVersionState → the snapshot's `sheetCells` (a read-only <CellGrid>), and compares
// a version against the live grid through the sheet's cell-level diff list.

const NAMED = {
  docVersionSeq: 7,
  kind: 'named' as const,
  label: 'Draft v1',
  createdBy: 'u_self',
  createdAt: '2026-06-20T10:00:00.000Z',
  sizeBytes: 1234,
  schemaVersion: 1,
  restoredFrom: null,
}
const AUTO = {
  docVersionSeq: 6,
  kind: 'auto' as const,
  label: '',
  createdBy: 'u_self',
  createdAt: '2026-06-20T09:30:00.000Z',
  sizeBytes: 999,
  schemaVersion: 1,
  restoredFrom: null,
}
const COUNTS = { auto: 5, manual: 2, restore: 1, total: 8 }

// A historical snapshot: A1 = "old", B1 = "gone" (dropped in current), C1 = "same".
const HISTORICAL_CELLS = {
  's1!0:0': { v: 'old' },
  's1!0:1': { v: 'gone' },
  's1!0:2': { v: 'same' },
}

const listVersionsMock = vi.fn(
  async (_docId: unknown, opts?: { kind?: string; cursor?: number | null }) => {
    if (opts?.cursor != null) return { items: [{ ...AUTO, docVersionSeq: 4 }], nextCursor: null, counts: COUNTS }
    return { items: [NAMED, AUTO], nextCursor: 100, counts: COUNTS }
  },
)
type StateResult = { sheetCells: Record<string, { v?: unknown }>; schemaVersion: number; docVersionSeq: number }
const defaultGetState = async (..._a: unknown[]): Promise<StateResult> => ({
  sheetCells: HISTORICAL_CELLS,
  schemaVersion: 1,
  docVersionSeq: 7,
})
const getVersionStateMock = vi.fn(defaultGetState)
const renameVersionMock = vi.fn(async () => undefined)
const restoreVersionMock = vi.fn(async () => ({ newDocVersionSeq: 9, restoredFrom: 7 }))

vi.mock('../versions/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../versions/api.ts')>()
  return {
    ...actual,
    listVersions: (docId: string, opts?: { kind?: string; cursor?: number | null }) =>
      listVersionsMock(docId, opts),
    getVersionState: (...a: unknown[]) => getVersionStateMock(...a),
    renameVersion: (...a: unknown[]) => renameVersionMock(...(a as [])),
    restoreVersion: (...a: unknown[]) => restoreVersionMock(...(a as [])),
  }
})

import { SheetVersionPanel } from './SheetVersionPanel.tsx'

/** A live sheet whose 'sheet' Y.Map holds the "current" cells (read-only in the panel). */
function fakeSheet(cells: Record<string, { v?: unknown }>): CollabSheet {
  return {
    ydoc: {
      getMap: () => ({ entries: () => Object.entries(cells) }),
    },
  } as unknown as CollabSheet
}

const btnByText = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement

beforeEach(() => {
  listVersionsMock.mockClear()
  getVersionStateMock.mockClear()
  getVersionStateMock.mockImplementation(defaultGetState)
  renameVersionMock.mockClear()
  restoreVersionMock.mockClear()
})
afterEach(() => cleanup())

describe('SheetVersionPanel — thin adapter over VersionHistoryPanel', () => {
  it('renders the shell as a single mixed list (kind="all") with the unified counts header', async () => {
    render(<SheetVersionPanel docId="d_1" role="admin" sheet={fakeSheet({})} />)
    await screen.findByText('Draft v1')
    // One flat shell list, not the old octo-comment-list threads.
    expect(document.querySelectorAll('.octo-version-list .octo-version-row').length).toBe(2)
    expect(document.querySelector('.octo-comment-thread')).toBeNull()
    // The shell requests the merged stream on mount.
    expect((listVersionsMock.mock.calls[0][1] as { kind?: string }).kind).toBe('all')
    // Counts header: manual(2)+restore(1)=3 · auto=5.
    const counts = document.querySelector('.octo-version-counts') as HTMLElement
    expect(counts.textContent).toContain('3')
    expect(counts.textContent).toContain('5')
  })

  it('exposes the filter tabs and reloads with the chosen kind', async () => {
    render(<SheetVersionPanel docId="d_1" role="admin" sheet={fakeSheet({})} />)
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.body, 'docs.version.filterAuto'))
    await waitFor(() =>
      expect(listVersionsMock.mock.calls.some((c) => (c[1] as { kind?: string })?.kind === 'auto')).toBe(true),
    )
  })

  it('previews a version through getVersionState and renders the snapshot cell grid', async () => {
    render(<SheetVersionPanel docId="d_1" role="admin" sheet={fakeSheet({})} />)
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.preview'))
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeTruthy())
    // Loaded via GET /versions/:seq/state for the clicked row (docId + seq + signal forwarded).
    expect(getVersionStateMock).toHaveBeenCalled()
    expect(getVersionStateMock.mock.calls[0][0]).toBe('d_1')
    expect(getVersionStateMock.mock.calls[0][1]).toBe(7)
    const modal = document.querySelector('.docs-version-preview-modal') as HTMLElement
    // The sheet preview is a read-only HTML grid of the snapshot cells, not a text editor.
    await waitFor(() => expect(modal.querySelector('.octo-sheet-preview-grid')).toBeTruthy())
    expect(modal.querySelector('.octo-sheet-preview-grid')!.textContent).toContain('old')
  })

  it('compares a version against the live grid via the cell-level diff list', async () => {
    // Current live grid: A1 changed to "new", B1 removed, C1 unchanged, D1 added.
    const sheet = fakeSheet({ 's1!0:0': { v: 'new' }, 's1!0:2': { v: 'same' }, 's1!0:3': { v: 'fresh' } })
    render(<SheetVersionPanel docId="d_1" role="admin" sheet={sheet} />)
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.preview'))
    const modal = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    await waitFor(() => expect(modal.querySelector('.octo-sheet-preview-grid')).toBeTruthy())
    // Toggle into compare → the sheet's cell-level diff list against the live grid.
    fireEvent.click(btnByText(modal, 'docs.version.compare'))
    const list = await waitFor(() => modal.querySelector('.octo-sheet-diff-list') as HTMLElement)
    const rows = Array.from(list.querySelectorAll('li'))
    const byAddr = (a1: string) => rows.find((r) => r.textContent?.startsWith(a1))
    // A1: old → new (changed); B1: removed; D1: added. C1 (unchanged) is absent.
    expect(byAddr('A1')?.textContent).toContain('docs.sheet.version.changed')
    expect(byAddr('A1')?.textContent).toContain('old')
    expect(byAddr('A1')?.textContent).toContain('new')
    expect(byAddr('B1')?.textContent).toContain('docs.sheet.version.removed')
    expect(byAddr('D1')?.textContent).toContain('docs.sheet.version.added')
    expect(byAddr('C1')).toBeUndefined()
  })

  it('gates restore/delete on admin — a writer sees neither', async () => {
    render(<SheetVersionPanel docId="d_1" role="writer" sheet={fakeSheet({})} />)
    await screen.findByText('Draft v1')
    const row = document.querySelector('.octo-version-row') as HTMLElement
    // writer can preview + save + rename, but must NOT restore or delete (canRestoreVersion = admin).
    expect(btnByText(row, 'docs.version.preview')).toBeTruthy()
    expect(btnByText(row, 'docs.version.restore')).toBeUndefined()
    expect(btnByText(row, 'docs.version.delete')).toBeUndefined()
  })

  it('appends the next page via load-more (pagination)', async () => {
    render(<SheetVersionPanel docId="d_1" role="admin" sheet={fakeSheet({})} />)
    await screen.findByText('Draft v1')
    expect(document.querySelectorAll('.octo-version-row').length).toBe(2)
    // nextCursor=100 → a load-more button is offered; clicking it fetches + appends the next page.
    fireEvent.click(btnByText(document.body, 'docs.version.loadMore'))
    await waitFor(() => expect(document.querySelectorAll('.octo-version-row').length).toBe(3))
    expect(listVersionsMock.mock.calls.some((c) => (c[1] as { cursor?: number })?.cursor === 100)).toBe(true)
  })

  it('renames a version via an inline input, not a native window.prompt', async () => {
    const promptSpy = vi.spyOn(window, 'prompt')
    render(<SheetVersionPanel docId="d_1" role="admin" sheet={fakeSheet({})} />)
    await screen.findByText('Draft v1')
    const row = document.querySelector('.octo-version-row') as HTMLElement // NAMED row (seq 7)
    fireEvent.click(btnByText(row, 'docs.version.rename'))
    // An inline input appears in the row — the native prompt is never used.
    const input = row.querySelector('input.octo-uid') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(promptSpy).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'Renamed v1' } })
    fireEvent.click(btnByText(row, 'docs.version.save'))
    await waitFor(() => expect(renameVersionMock).toHaveBeenCalled())
    expect(renameVersionMock.mock.calls[0]).toEqual(['d_1', 7, 'Renamed v1'])
    promptSpy.mockRestore()
  })

  it('guards the preview against a stale out-of-order response (race guard)', async () => {
    // Control resolution order: seq 7 (clicked first) resolves LAST, seq 6 resolves first.
    const resolvers = new Map<number, () => void>()
    getVersionStateMock.mockImplementation((...args: unknown[]) => {
      const seq = args[1] as number
      return new Promise<StateResult>((resolve) => {
        resolvers.set(seq, () =>
          resolve({ sheetCells: { 'sh!0:0': { v: `snap-${seq}` } }, schemaVersion: 1, docVersionSeq: seq }),
        )
      })
    })
    render(<SheetVersionPanel docId="d_1" role="admin" sheet={fakeSheet({})} />)
    await screen.findByText('Draft v1')
    const rows = document.querySelectorAll('.octo-version-row')
    // Preview #7 first, then #6 — before either has resolved.
    fireEvent.click(btnByText(rows[0] as HTMLElement, 'docs.version.preview'))
    fireEvent.click(btnByText(rows[1] as HTMLElement, 'docs.version.preview'))
    await waitFor(() => expect(resolvers.has(7) && resolvers.has(6)).toBe(true))
    // Resolve the NEWER selection (seq 6) first, then the superseded earlier one (seq 7).
    await act(async () => {
      resolvers.get(6)!()
    })
    await act(async () => {
      resolvers.get(7)!()
    })
    const modal = document.querySelector('.docs-version-preview-modal') as HTMLElement
    // The stale seq-7 response must NOT overwrite the seq-6 selection the guard now owns.
    await waitFor(() => expect(modal.querySelector('.octo-sheet-preview-grid')?.textContent).toContain('snap-6'))
    expect(modal.querySelector('.octo-sheet-preview-grid')?.textContent).not.toContain('snap-7')
  })

  it('preview renders the snapshot and never mutates the live sheet', async () => {
    // A live sheet whose map throws on any write — a mutation attempt would fail the test.
    const guarded = {
      ydoc: {
        getMap: () => ({
          entries: () => Object.entries({ 'sh!0:0': { v: 'live' } }),
          set: () => {
            throw new Error('preview must not write the live sheet')
          },
          delete: () => {
            throw new Error('preview must not write the live sheet')
          },
        }),
      },
    } as unknown as CollabSheet
    render(<SheetVersionPanel docId="d_1" role="admin" sheet={guarded} />)
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.preview'))
    const modal = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    await waitFor(() => expect(modal.querySelector('.octo-sheet-preview-grid')).toBeTruthy())
    // Preview shows the SNAPSHOT cells ('old'), never the live grid ('live') — and no write threw.
    const gridText = modal.querySelector('.octo-sheet-preview-grid')!.textContent || ''
    expect(gridText).toContain('old')
    expect(gridText).not.toContain('live')
  })
})
