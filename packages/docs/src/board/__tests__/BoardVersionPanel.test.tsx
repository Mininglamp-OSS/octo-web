import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import type { ReactNode } from 'react'

// XIN-844: BoardVersionPanel is now a THIN ADAPTER over the unified <VersionHistoryPanel> shell
// (following the doc adapter XIN-840 / sheet adapter XIN-842). The shell's own behavior (list /
// filter / counts / load-more, the preview-modal machine, race guard, mutations, role gating, the
// in-panel restore confirm box) is pinned by VersionHistoryPanel.test.tsx. These tests pin only the
// board-specific wiring the adapter injects: it renders the shell as a single mixed list, loads a
// preview via getBoardVersionState → the snapshot's Excalidraw scene (a read-only canvas in the
// shell's centered modal), offers NO compare (the board passes neither renderDiff nor getCurrent),
// and routes preview/restore errors through the board's versionErrorKey classifier so the wider
// 403 / 409 / 413 / 404 failure set surfaces a distinct message.

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
    return { items: [NAMED, AUTO], nextCursor: 100, counts: COUNTS }
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

const btnByText = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement

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

describe('BoardVersionPanel — thin adapter over VersionHistoryPanel', () => {
  it('renders the shell as a single mixed list (kind="all") with the unified counts header', async () => {
    await renderPanel()
    // The shell requests the merged stream on mount, at the board's page size.
    expect(listVersions).toHaveBeenCalledWith('bd_1', { kind: 'all', limit: 30, signal: expect.any(AbortSignal) })
    // One flat shell list, not the old octo-comment-list threads.
    expect(document.querySelectorAll('.octo-version-list .octo-version-row').length).toBe(2)
    expect(document.querySelector('.octo-comment-thread')).toBeNull()
    // Counts header: manual(2)+restore(1)=3 · auto=5.
    const counts = document.querySelector('.octo-version-counts') as HTMLElement
    expect(counts.textContent).toContain('3')
    expect(counts.textContent).toContain('5')
  })

  it('re-queries with the selected kind filter', async () => {
    await renderPanel()
    fireEvent.click(btnByText(document.body, 'docs.version.filterAuto'))
    await waitFor(() =>
      expect(listVersions).toHaveBeenLastCalledWith('bd_1', { kind: 'auto', limit: 30, signal: expect.any(AbortSignal) }),
    )
  })

  it('paginates via load more using nextCursor', async () => {
    await renderPanel()
    fireEvent.click(btnByText(document.body, 'docs.version.loadMore'))
    await waitFor(() =>
      expect(listVersions).toHaveBeenLastCalledWith('bd_1', { kind: 'all', cursor: 100, limit: 30, signal: expect.any(AbortSignal) }),
    )
    await screen.findByText('Older')
  })

  it('creates a named version from the inline compose row (writer+)', async () => {
    await renderPanel('writer')
    fireEvent.click(btnByText(document.body, 'docs.version.saveCurrent'))
    fireEvent.change(screen.getByPlaceholderText('docs.version.labelPlaceholder'), {
      target: { value: '  v2  ' },
    })
    fireEvent.click(btnByText(document.body, 'docs.version.save'))
    await waitFor(() => expect(createNamedVersion).toHaveBeenCalledWith('bd_1', 'v2'))
  })

  it('renames a named version inline (no native window.prompt) and refetches the list', async () => {
    const promptSpy = vi.spyOn(window, 'prompt')
    await renderPanel('admin')
    const row = document.querySelector('.octo-version-row') as HTMLElement // NAMED row (seq 7)
    fireEvent.click(btnByText(row, 'docs.version.rename'))
    const input = row.querySelector('input.octo-uid') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(promptSpy).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '  renamed  ' } })
    listVersions.mockClear()
    fireEvent.click(btnByText(row, 'docs.version.save'))
    await waitFor(() => expect(renameVersion).toHaveBeenCalledWith('bd_1', 7, 'renamed'))
    await waitFor(() => expect(listVersions).toHaveBeenCalled())
    promptSpy.mockRestore()
  })

  it('renders a read-only Excalidraw scene preview in the centered modal for the selected version', async () => {
    await renderPanel('admin')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.preview'))
    // The preview loads via getBoardVersionState → getVersionState for the clicked row (docId + seq).
    await waitFor(() => expect(getVersionState).toHaveBeenCalledWith('bd_1', 7, expect.any(AbortSignal)))
    const modal = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    // The board preview is a real (mocked) Excalidraw canvas mounted inside the shell's centered modal.
    await waitFor(() => expect(modal.querySelector('[data-testid="excalidraw-canvas"]')).toBeTruthy())
    expect(modal.querySelector('.octo-board-version-preview')).toBeTruthy()
  })

  it('offers NO compare entry — the board passes neither renderDiff nor getCurrent', async () => {
    await renderPanel('admin')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.preview'))
    const modal = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    await waitFor(() => expect(modal.querySelector('[data-testid="excalidraw-canvas"]')).toBeTruthy())
    // Decision #4: whiteboard preview is read-only only, so the shell hides the compare button.
    expect(btnByText(modal, 'docs.version.compare')).toBeUndefined()
  })

  it('restores a version via the in-panel confirm box and shows the restored notice', async () => {
    await renderPanel('admin')
    const row = document.querySelector('.octo-version-row') as HTMLElement
    // Clicking Restore opens the shell's in-panel confirm box (not a native window.confirm).
    fireEvent.click(btnByText(row, 'docs.version.restore'))
    const confirm = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    fireEvent.click(btnByText(confirm, 'docs.version.restore'))
    await waitFor(() => expect(restoreVersion).toHaveBeenCalledWith('bd_1', 7))
    await screen.findByText(/docs\.version\.restoredNotice/)
  })

  it('surfaces the board 413 payload-too-large message on restore (versionErrorKey)', async () => {
    restoreVersion.mockRejectedValueOnce({ response: { status: 413, data: {} } })
    await renderPanel('admin')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row') as HTMLElement, 'docs.version.restore'))
    const confirm = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    fireEvent.click(btnByText(confirm, 'docs.version.restore'))
    await screen.findByText('docs.board.version.errTooLarge')
  })

  it('surfaces the board 403 forbidden message on restore (versionErrorKey)', async () => {
    restoreVersion.mockRejectedValueOnce({ response: { status: 403, data: { error: 'epoch_changed' } } })
    await renderPanel('admin')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row') as HTMLElement, 'docs.version.restore'))
    const confirm = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    fireEvent.click(btnByText(confirm, 'docs.version.restore'))
    await screen.findByText('docs.board.version.errForbidden')
  })

  it('surfaces the board 404 not-found message on preview (versionErrorKey via previewErrorKey)', async () => {
    getVersionState.mockRejectedValueOnce({ response: { status: 404, data: {} } })
    await renderPanel('admin')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row') as HTMLElement, 'docs.version.preview'))
    await screen.findByText('docs.board.version.errNotFound')
  })

  it('deletes a version after confirmation and refetches the list', async () => {
    await renderPanel('admin')
    listVersions.mockClear()
    fireEvent.click(btnByText(document.querySelector('.octo-version-row') as HTMLElement, 'docs.version.delete'))
    const confirm = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    fireEvent.click(btnByText(confirm, 'docs.version.delete'))
    await waitFor(() => expect(deleteVersion).toHaveBeenCalledWith('bd_1', 7))
    await waitFor(() => expect(listVersions).toHaveBeenCalled())
  })

  it('gates restore/delete on admin and rename/save on writer — a reader gets only preview', async () => {
    await renderPanel('reader')
    const row = document.querySelector('.octo-version-row') as HTMLElement
    expect(btnByText(row, 'docs.version.preview')).toBeTruthy()
    expect(btnByText(row, 'docs.version.restore')).toBeUndefined()
    expect(btnByText(row, 'docs.version.delete')).toBeUndefined()
    expect(btnByText(row, 'docs.version.rename')).toBeUndefined()
    // No "save current version" affordance for a reader.
    expect(btnByText(document.body, 'docs.version.saveCurrent')).toBeUndefined()
  })

  it('lets a writer save + rename but NOT restore or delete (canRestoreVersion = admin)', async () => {
    await renderPanel('writer')
    const row = document.querySelector('.octo-version-row') as HTMLElement
    expect(btnByText(document.body, 'docs.version.saveCurrent')).toBeTruthy()
    expect(btnByText(row, 'docs.version.rename')).toBeTruthy()
    expect(btnByText(row, 'docs.version.restore')).toBeUndefined()
    expect(btnByText(row, 'docs.version.delete')).toBeUndefined()
  })

  it('treats a failed post-restore refresh as a soft stale notice, not a restore failure', async () => {
    await renderPanel('admin')
    // The mutation itself succeeds; only the follow-up list refresh fails (transient network).
    listVersions.mockRejectedValueOnce(new Error('network'))
    fireEvent.click(btnByText(document.querySelector('.octo-version-row') as HTMLElement, 'docs.version.restore'))
    const confirm = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    fireEvent.click(btnByText(confirm, 'docs.version.restore'))
    await waitFor(() => expect(restoreVersion).toHaveBeenCalledWith('bd_1', 7))
    // Restore landed → show the soft "list may be stale" notice, never the red "restore failed".
    await screen.findByText('docs.version.staleNotice')
    expect(screen.queryByText('docs.board.version.errRestore')).toBeNull()
  })

  it('previews the correct row seq after switching selection (keyed remount source)', async () => {
    await renderPanel('admin')
    const rows = document.querySelectorAll('.octo-version-row')
    // Preview the NAMED row (seq 7) then the AUTO row (seq 6): the adapter forwards each row's seq to
    // getBoardVersionState, which is the seq the shell keys the preview remount on.
    fireEvent.click(btnByText(rows[0] as HTMLElement, 'docs.version.preview'))
    await waitFor(() => expect(getVersionState).toHaveBeenLastCalledWith('bd_1', 7, expect.any(AbortSignal)))
    fireEvent.click(btnByText(rows[1] as HTMLElement, 'docs.version.preview'))
    await waitFor(() => expect(getVersionState).toHaveBeenLastCalledWith('bd_1', 6, expect.any(AbortSignal)))
  })
})
