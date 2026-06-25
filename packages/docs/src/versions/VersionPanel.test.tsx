import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'

// Batch 8 item 2: the version preview/compare moved out of the sidebar drawer into a centered,
// scrollable modal. The sidebar keeps only the version list; clicking "preview" on a row opens the
// modal, which keeps the preview/compare toggle and closes on overlay-click / Escape. The
// previewGuard + previewState machine and the (row-triggered) restore flow are unchanged.

const VERSION = {
  docVersionSeq: 7,
  kind: 'named' as const,
  label: 'Draft v1',
  createdBy: 'u_self',
  createdAt: '2026-06-20T10:00:00.000Z',
  sizeBytes: 1234,
  schemaVersion: 1,
  restoredFrom: null,
}

const listVersionsMock = vi.fn(async (..._a: unknown[]) => ({ items: [VERSION], nextCursor: null }))
const getVersionStateMock = vi.fn(async (..._a: unknown[]) => ({
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'historical body' }] }] },
  schemaVersion: 1,
}))

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>()
  return {
    ...actual,
    listVersions: (...a: unknown[]) => listVersionsMock(...a),
    getVersionState: (...a: unknown[]) => getVersionStateMock(...a),
  }
})

// VersionPreview builds a throwaway Tiptap editor; stub the react binding so the test stays light.
vi.mock('@tiptap/react', () => ({
  useEditor: () => null,
  EditorContent: ({ className }: { className?: string }) => (
    <div className={className} data-testid="version-preview-content">historical body</div>
  ),
}))

import { VersionPanel } from './VersionPanel.tsx'

beforeEach(() => {
  listVersionsMock.mockClear()
  getVersionStateMock.mockClear()
})

afterEach(() => cleanup())

async function renderAndPreview() {
  render(<VersionPanel docId="d_1" role="admin" />)
  // Wait for the list to load and the row's "preview" action to appear.
  const previewBtn = await screen.findByText('docs.version.preview')
  // No modal until preview is clicked.
  expect(document.querySelector('.docs-version-preview-modal')).toBeNull()
  fireEvent.click(previewBtn)
  // The state fetch resolves and the modal shows the preview.
  await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeTruthy())
  return previewBtn
}

describe('VersionPanel — preview modal (item 2)', () => {
  it('opens a centered modal (not an inline sidebar detail) on preview click, showing the content', async () => {
    await renderAndPreview()
    const modal = document.querySelector('.docs-version-preview-modal') as HTMLElement
    // It is a modal dialog mounted on the shared overlay.
    expect(modal.closest('.octo-modal-overlay')).toBeTruthy()
    expect(modal.getAttribute('role')).toBe('dialog')
    // The historical content renders inside the modal's scrollable body.
    await waitFor(() =>
      expect(modal.querySelector('[data-testid="version-preview-content"]')).toBeTruthy(),
    )
    expect(modal.querySelector('.docs-version-preview-modal-body')).toBeTruthy()
    // The sidebar section no longer carries the inline preview detail.
    expect(document.querySelector('.octo-version-panel .octo-version-detail')).toBeNull()
  })

  it('keeps the preview / compare toggle inside the modal', async () => {
    await renderAndPreview()
    const modal = document.querySelector('.docs-version-preview-modal') as HTMLElement
    // Starts on preview → the toggle offers "compare".
    const toggle = await waitFor(() => {
      const b = Array.from(modal.querySelectorAll('button')).find(
        (el) => el.textContent === 'docs.version.compare',
      )
      expect(b).toBeTruthy()
      return b as HTMLButtonElement
    })
    expect(toggle.disabled).toBe(false)
    fireEvent.click(toggle)
    // Now in compare mode → the toggle offers "show preview" again.
    expect(
      Array.from(modal.querySelectorAll('button')).some(
        (el) => el.textContent === 'docs.version.showPreview',
      ),
    ).toBe(true)
  })

  it('closes the modal on overlay click', async () => {
    await renderAndPreview()
    const overlay = document.querySelector('.octo-modal-overlay') as HTMLElement
    fireEvent.mouseDown(overlay)
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeNull())
  })

  it('does not close when the dialog body itself is clicked (overlay stopPropagation)', async () => {
    await renderAndPreview()
    const modal = document.querySelector('.docs-version-preview-modal') as HTMLElement
    fireEvent.mouseDown(modal)
    expect(document.querySelector('.docs-version-preview-modal')).toBeTruthy()
  })

  it('closes the modal on Escape', async () => {
    await renderAndPreview()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeNull())
  })

  it('closes via the modal close button', async () => {
    await renderAndPreview()
    const modal = document.querySelector('.docs-version-preview-modal') as HTMLElement
    const close = Array.from(modal.querySelectorAll('button')).find(
      (el) => el.textContent === 'docs.version.close',
    ) as HTMLButtonElement
    fireEvent.click(close)
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeNull())
  })
})
