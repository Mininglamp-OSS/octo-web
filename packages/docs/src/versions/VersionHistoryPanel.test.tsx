import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'

// XIN-837 (拆单阶段 1): the unified <VersionHistoryPanel> shell. These tests pin the behavior the
// three end panels will inherit: a single mixed list with filter tabs + counts + load-more, the
// centered preview/diff modal (Esc / overlay-close / stopPropagation), inline save/rename (no native
// prompt), the in-panel restore confirm box, role-gated affordances, and the unified race guard —
// a slow earlier preview must never overwrite a newer selection.

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

const listVersionsMock = vi.fn(
  async (_docId: unknown, opts?: { kind?: string; cursor?: number | null }) => {
    if (opts?.cursor != null) return { items: [{ ...AUTO, docVersionSeq: 4 }], nextCursor: null, counts: COUNTS }
    return { items: [NAMED, AUTO], nextCursor: 100, counts: COUNTS }
  },
)
const createNamedVersionMock = vi.fn(async () => 8)
const restoreVersionMock = vi.fn(async () => ({ newDocVersionSeq: 9, restoredFrom: 7 }))
const renameVersionMock = vi.fn(async () => undefined)
const deleteVersionMock = vi.fn(async () => undefined)

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>()
  return {
    ...actual,
    listVersions: (...a: unknown[]) => listVersionsMock(...(a as [unknown, { kind?: string }?])),
    createNamedVersion: (...a: unknown[]) => createNamedVersionMock(...(a as [])),
    restoreVersion: (...a: unknown[]) => restoreVersionMock(...(a as [])),
    renameVersion: (...a: unknown[]) => renameVersionMock(...(a as [])),
    deleteVersion: (...a: unknown[]) => deleteVersionMock(...(a as [])),
  }
})

import { VersionHistoryPanel } from './VersionHistoryPanel.tsx'
import type { Role } from '../auth/roles.ts'

interface PreviewState {
  body: string
}

/** A default host wiring for the shell: preview returns a tagged body; diff/current provided. */
function renderPanel(
  role: Role = 'admin',
  overrides: Partial<{
    loadPreviewState: (seq: number, signal: AbortSignal) => Promise<PreviewState>
    renderDiff?: (s: PreviewState, c: string | null) => React.ReactNode
    getCurrent?: () => string | null
    onRestored?: () => void
  }> = {},
) {
  const loadPreviewState =
    overrides.loadPreviewState ?? (async (seq: number) => ({ body: `body-${seq}` }))
  return render(
    <VersionHistoryPanel<PreviewState, string>
      docId="d_1"
      role={role}
      loadPreviewState={loadPreviewState}
      renderPreview={(s) => <div data-testid="preview-body">{s.body}</div>}
      renderDiff={
        'renderDiff' in overrides
          ? overrides.renderDiff
          : (s, c) => <div data-testid="diff-body">{`${s.body}|${c ?? 'null'}`}</div>
      }
      getCurrent={'getCurrent' in overrides ? overrides.getCurrent : () => 'CURRENT'}
      onRestored={overrides.onRestored}
    />,
  )
}

const btnByText = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement

beforeEach(() => {
  listVersionsMock.mockClear()
  createNamedVersionMock.mockClear()
  restoreVersionMock.mockClear()
  renameVersionMock.mockClear()
  deleteVersionMock.mockClear()
})
afterEach(() => cleanup())

describe('VersionHistoryPanel — list / filter / counts', () => {
  it('renders a single mixed list and requests kind="all" on mount', async () => {
    renderPanel()
    await screen.findByText('Draft v1')
    expect(document.querySelectorAll('.octo-version-list .octo-version-row').length).toBe(2)
    expect((listVersionsMock.mock.calls[0][1] as { kind?: string }).kind).toBe('all')
  })

  it('shows the unified counts header (manual+restore · auto)', async () => {
    renderPanel()
    await screen.findByText('Draft v1')
    const counts = document.querySelector('.octo-version-counts') as HTMLElement
    // manual(2) + restore(1) = 3 · auto = 5
    expect(counts.textContent).toContain('3')
    expect(counts.textContent).toContain('5')
  })

  it('reloads with the chosen kind when a filter tab is clicked', async () => {
    renderPanel()
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.body, 'docs.version.filterManual'))
    await waitFor(() =>
      expect(listVersionsMock.mock.calls.some((c) => (c[1] as { kind?: string })?.kind === 'manual')).toBe(true),
    )
  })

  it('pages the current filter via cursor on load-more', async () => {
    renderPanel()
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.body, 'docs.version.loadMore'))
    await waitFor(() =>
      expect(listVersionsMock.mock.calls.some((c) => (c[1] as { cursor?: number })?.cursor === 100)).toBe(true),
    )
  })
})

describe('VersionHistoryPanel — centered preview modal', () => {
  it('opens a centered modal (not inline) and renders the injected preview, honoring the signal', async () => {
    const seen: AbortSignal[] = []
    renderPanel('admin', {
      loadPreviewState: async (seq, signal) => {
        seen.push(signal)
        return { body: `body-${seq}` }
      },
    })
    await screen.findByText('Draft v1')
    expect(document.querySelector('.docs-version-preview-modal')).toBeNull()
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.preview'))
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeTruthy())
    const modal = document.querySelector('.docs-version-preview-modal') as HTMLElement
    expect(modal.closest('.octo-modal-overlay')).toBeTruthy()
    expect(modal.getAttribute('role')).toBe('dialog')
    await waitFor(() => expect(modal.querySelector('[data-testid="preview-body"]')?.textContent).toBe('body-7'))
    // The host received a real AbortSignal.
    expect(seen[0]).toBeInstanceOf(AbortSignal)
  })

  it('closes on Escape and on overlay click, but not when the dialog body is clicked', async () => {
    renderPanel()
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.preview'))
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeTruthy())
    // Body click does not close (stopPropagation).
    fireEvent.mouseDown(document.querySelector('.docs-version-preview-modal')!)
    expect(document.querySelector('.docs-version-preview-modal')).toBeTruthy()
    // Escape closes.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeNull())
  })

  it('offers the compare toggle only when renderDiff + getCurrent are provided', async () => {
    // With diff+current: toggle appears and renders the injected diff.
    renderPanel()
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.preview'))
    const modal = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    await waitFor(() => expect(modal.querySelector('[data-testid="preview-body"]')).toBeTruthy())
    const toggle = btnByText(modal, 'docs.version.compare')
    expect(toggle).toBeTruthy()
    fireEvent.click(toggle)
    await waitFor(() => expect(modal.querySelector('[data-testid="diff-body"]')?.textContent).toBe('body-7|CURRENT'))

    cleanup()
    // Without diff (board case): no compare toggle.
    renderPanel('admin', { renderDiff: undefined, getCurrent: undefined })
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.preview'))
    const modal2 = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    await waitFor(() => expect(modal2.querySelector('[data-testid="preview-body"]')).toBeTruthy())
    expect(btnByText(modal2, 'docs.version.compare')).toBeUndefined()
  })
})

describe('VersionHistoryPanel — race guard', () => {
  it('a slow earlier preview never overwrites a newer selection', async () => {
    const deferreds = new Map<number, (v: PreviewState) => void>()
    const signals = new Map<number, AbortSignal>()
    renderPanel('admin', {
      loadPreviewState: (seq, signal) => {
        signals.set(seq, signal)
        return new Promise<PreviewState>((resolve) => deferreds.set(seq, resolve))
      },
    })
    await screen.findByText('Draft v1')
    const rows = document.querySelectorAll('.octo-version-row')
    // Preview #7 (slow), then #6 (fast) before #7 resolves.
    fireEvent.click(btnByText(rows[0], 'docs.version.preview'))
    fireEvent.click(btnByText(rows[1], 'docs.version.preview'))
    // The newer request aborted the earlier one on the wire.
    expect(signals.get(7)!.aborted).toBe(true)
    // Resolve the newer one first, then the stale earlier one.
    deferreds.get(6)!({ body: 'body-6' })
    await waitFor(() =>
      expect(document.querySelector('[data-testid="preview-body"]')?.textContent).toBe('body-6'),
    )
    deferreds.get(7)!({ body: 'body-7' })
    // The stale #7 response is discarded — the modal still shows #6.
    await waitFor(() => {})
    expect(document.querySelector('[data-testid="preview-body"]')?.textContent).toBe('body-6')
  })
})

describe('VersionHistoryPanel — mutations & permissions', () => {
  it('restore goes through an in-panel confirm box (not window.confirm) and fires onRestored', async () => {
    const onRestored = vi.fn()
    renderPanel('admin', { onRestored })
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.restore'))
    // A centered confirm box appears in-panel.
    const confirm = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    fireEvent.click(btnByText(confirm, 'docs.version.restore'))
    await waitFor(() => expect(restoreVersionMock).toHaveBeenCalled())
    await waitFor(() => expect(onRestored).toHaveBeenCalled())
  })

  it('renames a named version inline (no native prompt)', async () => {
    renderPanel('admin')
    await screen.findByText('Draft v1')
    const row = document.querySelector('.octo-version-row-named') as HTMLElement
    fireEvent.click(btnByText(row, 'docs.version.rename'))
    const input = row.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.click(btnByText(row, 'docs.version.save'))
    await waitFor(() => expect(renameVersionMock).toHaveBeenCalledWith('d_1', 7, 'Renamed'))
  })

  it('gates save/restore/delete/rename behind role (reader sees none)', async () => {
    renderPanel('reader')
    await screen.findByText('Draft v1')
    expect(btnByText(document.body, 'docs.version.saveCurrent')).toBeUndefined()
    const row = document.querySelector('.octo-version-row') as HTMLElement
    expect(btnByText(row, 'docs.version.restore')).toBeUndefined()
    expect(btnByText(row, 'docs.version.delete')).toBeUndefined()
    expect(btnByText(row, 'docs.version.rename')).toBeUndefined()
    // Preview stays available to readers.
    expect(btnByText(row, 'docs.version.preview')).toBeTruthy()
  })

  it('writer can save + rename but cannot restore/delete', async () => {
    renderPanel('writer')
    await screen.findByText('Draft v1')
    expect(btnByText(document.body, 'docs.version.saveCurrent')).toBeTruthy()
    const row = document.querySelector('.octo-version-row-named') as HTMLElement
    expect(btnByText(row, 'docs.version.rename')).toBeTruthy()
    expect(btnByText(row, 'docs.version.restore')).toBeUndefined()
    expect(btnByText(row, 'docs.version.delete')).toBeUndefined()
  })
})
