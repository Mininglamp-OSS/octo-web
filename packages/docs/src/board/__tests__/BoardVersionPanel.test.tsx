import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import type { ReactNode } from 'react'

// The board version panel reuses the shared version REST layer (versions/api.ts) for list / create /
// rename / delete, and the board-specific getBoardVersionState (built on the shared getVersionState)
// for the read-only scene preview. We mock versions/api.ts so both the panel's direct calls AND
// getBoardVersionState's inner getVersionState call resolve from the same double; versionErrorKey
// runs real so the 403/409/413 mapping is exercised end-to-end through the panel.

const NAMED = {
  docVersionSeq: 7,
  kind: 'named' as const,
  label: 'Milestone',
  createdBy: 'u_self',
  createdAt: '2026-06-20T10:00:00.000Z',
  sizeBytes: 100,
  schemaVersion: 1,
  restoredFrom: null,
}
const AUTO = {
  docVersionSeq: 6,
  kind: 'auto' as const,
  label: '',
  createdBy: 'u_self',
  createdAt: '2026-06-20T09:30:00.000Z',
  sizeBytes: 50,
  schemaVersion: 1,
  restoredFrom: null,
}
const COUNTS = { auto: 5, manual: 2, restore: 1, total: 8 }

const listVersions = vi.fn(
  async (_docId: string, opts?: { kind?: string; cursor?: number | null }) => {
    if (opts?.kind === 'auto') return { items: [AUTO], nextCursor: null, counts: COUNTS }
    if (opts?.cursor != null) return { items: [{ ...NAMED, docVersionSeq: 4, label: 'Older' }], nextCursor: null, counts: COUNTS }
    return { items: [NAMED], nextCursor: 100, counts: COUNTS }
  },
)
const createNamedVersion = vi.fn(async () => 8)
const renameVersion = vi.fn(async () => {})
const deleteVersion = vi.fn(async () => {})
const restoreVersion = vi.fn(async () => ({ newDocVersionSeq: 9, restoredFrom: 7 }))
const getVersionState = vi.fn(async () => ({
  kind: 'board',
  scene: { elements: [{ id: 'r1' }], files: {} },
  schemaVersion: 1,
  docVersionSeq: 7,
}))

vi.mock('../../versions/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../versions/api.ts')>()
  return {
    ...actual, // keep the real typed-error classes so versionErrorKey/instanceof still work
    listVersions: (...a: unknown[]) => listVersions(...(a as [string, { kind?: string; cursor?: number | null }?])),
    createNamedVersion: (...a: unknown[]) => createNamedVersion(...(a as [])),
    renameVersion: (...a: unknown[]) => renameVersion(...(a as [])),
    deleteVersion: (...a: unknown[]) => deleteVersion(...(a as [])),
    restoreVersion: (...a: unknown[]) => restoreVersion(...(a as [])),
    getVersionState: (...a: unknown[]) => getVersionState(...(a as [])),
  }
})

// Read-only Excalidraw preview stand-in: render a marker node so the preview can be asserted without
// pulling the heavy client-only canvas into jsdom.
vi.mock('@excalidraw/excalidraw', () => {
  const Excalidraw = ({ children }: { children?: ReactNode }) => (
    <div data-testid="excalidraw-canvas">{children}</div>
  )
  const MainMenu = (() => null) as unknown as { DefaultItems: Record<string, unknown> }
  MainMenu.DefaultItems = {}
  return {
    Excalidraw,
    MainMenu,
    restoreElements: (els: readonly unknown[] | null | undefined) => (els ? [...els] : []),
  }
})
vi.mock('@excalidraw/excalidraw/index.css', () => ({}))

import { BoardVersionPanel } from '../BoardVersionPanel.tsx'

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function renderPanel(role: 'reader' | 'writer' | 'admin' = 'admin') {
  render(<BoardVersionPanel docId="bd_1" role={role} />)
  await screen.findByText('Milestone')
}

describe('BoardVersionPanel', () => {
  it('lists versions with counts', async () => {
    await renderPanel()
    expect(listVersions).toHaveBeenCalledWith('bd_1', { kind: 'all', limit: 30, signal: expect.any(AbortSignal) })
    expect(screen.getByText('Milestone')).toBeTruthy()
    // counts: manual(2)+restore(1)=3 and auto=5
    const counts = document.querySelector('.octo-board-version-counts')
    expect(counts?.textContent).toContain('3')
    expect(counts?.textContent).toContain('5')
  })

  it('re-queries with the selected kind filter', async () => {
    await renderPanel()
    fireEvent.click(screen.getByText('docs.board.version.filterAuto'))
    await waitFor(() => expect(listVersions).toHaveBeenLastCalledWith('bd_1', { kind: 'auto', limit: 30, signal: expect.any(AbortSignal) }))
  })

  it('paginates via load more using nextCursor', async () => {
    await renderPanel()
    fireEvent.click(screen.getByText('docs.board.version.loadMore'))
    await waitFor(() => expect(listVersions).toHaveBeenLastCalledWith('bd_1', { kind: 'all', cursor: 100, limit: 30, signal: expect.any(AbortSignal) }))
    await screen.findByText('Older')
  })

  it('creates a named version from the inline compose row', async () => {
    await renderPanel('writer')
    fireEvent.click(screen.getByText('docs.board.version.save'))
    fireEvent.change(screen.getByPlaceholderText('docs.board.version.labelPlaceholder'), {
      target: { value: '  v2  ' },
    })
    fireEvent.click(screen.getByText('docs.board.version.saveAction'))
    await waitFor(() => expect(createNamedVersion).toHaveBeenCalledWith('bd_1', 'v2'))
  })

  it('renames a named version inline and refetches the list', async () => {
    await renderPanel('admin')
    // Clicking Rename opens an in-panel input (no native window.prompt).
    fireEvent.click(screen.getByText('docs.board.version.rename'))
    const input = screen.getByPlaceholderText('docs.board.version.renamePrompt')
    fireEvent.change(input, { target: { value: '  renamed  ' } })
    listVersions.mockClear()
    fireEvent.click(screen.getByText('docs.board.version.saveAction'))
    await waitFor(() => expect(renameVersion).toHaveBeenCalledWith('bd_1', 7, 'renamed'))
    // The list refetches after a successful rename so the row reflects the change.
    await waitFor(() => expect(listVersions).toHaveBeenCalled())
  })

  it('cancels an inline rename without calling the API', async () => {
    await renderPanel('admin')
    fireEvent.click(screen.getByText('docs.board.version.rename'))
    fireEvent.change(screen.getByPlaceholderText('docs.board.version.renamePrompt'), {
      target: { value: 'nope' },
    })
    fireEvent.click(screen.getByText('docs.board.version.cancel'))
    expect(renameVersion).not.toHaveBeenCalled()
    // Back to the normal action row.
    expect(screen.getByText('docs.board.version.rename')).toBeTruthy()
  })

  it('deletes a version after confirmation and refetches the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderPanel('admin')
    listVersions.mockClear()
    fireEvent.click(screen.getByText('docs.board.version.delete'))
    await waitFor(() => expect(deleteVersion).toHaveBeenCalledWith('bd_1', 7))
    await waitFor(() => expect(listVersions).toHaveBeenCalled())
  })

  it('renders a read-only scene preview for the selected version', async () => {
    await renderPanel('admin')
    fireEvent.click(screen.getByText('docs.board.version.preview'))
    await waitFor(() => expect(getVersionState).toHaveBeenCalledWith('bd_1', 7, expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByTestId('excalidraw-canvas')).toBeTruthy())
  })

  it('restores a version and shows the restored notice', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderPanel('admin')
    fireEvent.click(screen.getByText('docs.board.version.restore'))
    await waitFor(() => expect(restoreVersion).toHaveBeenCalledWith('bd_1', 7))
    await screen.findByText('docs.board.version.restoredNotice')
  })

  it('surfaces 413 payload-too-large on restore', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    restoreVersion.mockRejectedValueOnce({ response: { status: 413, data: {} } })
    await renderPanel('admin')
    fireEvent.click(screen.getByText('docs.board.version.restore'))
    await screen.findByText('docs.board.version.errTooLarge')
  })

  it('surfaces 403 forbidden on restore', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    restoreVersion.mockRejectedValueOnce({ response: { status: 403, data: { error: 'epoch_changed' } } })
    await renderPanel('admin')
    fireEvent.click(screen.getByText('docs.board.version.restore'))
    await screen.findByText('docs.board.version.errForbidden')
  })

  it('surfaces 409 conflict on restore', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    restoreVersion.mockRejectedValueOnce({ response: { status: 409, data: { error: 'conflict' } } })
    await renderPanel('admin')
    fireEvent.click(screen.getByText('docs.board.version.restore'))
    await screen.findByText('docs.board.version.errConflict')
  })

  it('hides restore/delete/rename for a reader', async () => {
    await renderPanel('reader')
    expect(screen.queryByText('docs.board.version.restore')).toBeNull()
    expect(screen.queryByText('docs.board.version.delete')).toBeNull()
    expect(screen.queryByText('docs.board.version.rename')).toBeNull()
    // reader may still preview
    expect(screen.getByText('docs.board.version.preview')).toBeTruthy()
  })

  it('treats a failed post-restore refresh as a soft stale notice, not a restore failure', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderPanel('admin')
    // The mutation itself succeeds; only the follow-up list refresh fails (transient network).
    listVersions.mockRejectedValueOnce(new Error('network'))
    fireEvent.click(screen.getByText('docs.board.version.restore'))
    await waitFor(() => expect(restoreVersion).toHaveBeenCalledWith('bd_1', 7))
    // Restore landed → show the soft "list may be stale" notice, never the red "restore failed".
    await screen.findByText('docs.board.version.staleNotice')
    expect(screen.queryByText('docs.board.version.errRestore')).toBeNull()
  })

  it('disables the filter buttons while a load-more page is in flight', async () => {
    await renderPanel()
    // The next listVersions call (the load-more page) hangs so it stays in flight.
    let resolveMore: (v: { items: typeof NAMED[]; nextCursor: null; counts: typeof COUNTS }) => void = () => {}
    listVersions.mockImplementationOnce(() => new Promise((r) => { resolveMore = r }))
    fireEvent.click(screen.getByText('docs.board.version.loadMore'))
    // A filter switch during an in-flight load-more would append the old filter's page and clobber
    // nextCursor — so the filter buttons must be disabled until the page settles.
    await waitFor(() =>
      expect((screen.getByText('docs.board.version.filterAuto') as HTMLButtonElement).disabled).toBe(true),
    )
    resolveMore({ items: [{ ...NAMED, docVersionSeq: 4, label: 'Older' }], nextCursor: null, counts: COUNTS })
    await screen.findByText('Older')
    expect((screen.getByText('docs.board.version.filterAuto') as HTMLButtonElement).disabled).toBe(false)
  })

  it('discards an out-of-order list response so a slow earlier refresh cannot overwrite a newer one', async () => {
    // A refresh fires whenever docId/kind changes (rapid filter switching is the finding's repro;
    // switching docId drives the same `refresh` and lets us overlap two requests deterministically,
    // since — unlike a filter click — it is not gated by the loading-disabled buttons).
    const resolveByDoc = new Map<string, () => void>()
    const deferredList = (docId: string, label: string): Promise<{ items: typeof NAMED[]; nextCursor: null; counts: typeof COUNTS }> =>
      new Promise((resolve) => {
        resolveByDoc.set(docId, () =>
          resolve({ items: [{ ...NAMED, docVersionSeq: 7, label }], nextCursor: null, counts: COUNTS }),
        )
      })
    listVersions.mockImplementation((docId: string) =>
      docId === 'bd_fast' ? deferredList('bd_fast', 'FastWins') : deferredList('bd_slow', 'SlowLoser'),
    )

    const { rerender } = render(<BoardVersionPanel docId="bd_slow" role="admin" />)
    // Fire the newer refresh before the first (slow) one has resolved.
    rerender(<BoardVersionPanel docId="bd_fast" role="admin" />)
    await waitFor(() => expect(resolveByDoc.has('bd_slow') && resolveByDoc.has('bd_fast')).toBe(true))

    // The newer refresh (bd_fast) resolves first and renders.
    await act(async () => {
      resolveByDoc.get('bd_fast')!()
      await Promise.resolve()
    })
    await screen.findByText('FastWins')

    // The older, slower refresh (bd_slow) lands late. Flush it fully: without the guard this stale
    // response would setItems(SlowLoser) and render it; the guard must discard it instead.
    await act(async () => {
      resolveByDoc.get('bd_slow')!()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('FastWins')).toBeTruthy()
    expect(screen.queryByText('SlowLoser')).toBeNull()
  })
})
