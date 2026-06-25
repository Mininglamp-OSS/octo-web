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

const AUTO_VERSION = {
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

// Kind-aware mock: the manual stream carries named+restore rows, the auto stream carries autosaves.
// Each stream has its own cursor; both responses embed the full per-kind counts.
const listVersionsMock = vi.fn(
  async (_docId: unknown, opts?: { kind?: string; cursor?: number | null }) => {
    const kind = opts?.kind
    const cursor = opts?.cursor
    if (kind === 'auto') {
      if (cursor == null) return { items: [AUTO_VERSION], nextCursor: 200, counts: COUNTS }
      return { items: [{ ...AUTO_VERSION, docVersionSeq: 5 }], nextCursor: null, counts: COUNTS }
    }
    if (cursor == null) return { items: [VERSION], nextCursor: 100, counts: COUNTS }
    return { items: [{ ...VERSION, docVersionSeq: 4 }], nextCursor: null, counts: COUNTS }
  },
)
const getVersionStateMock = vi.fn(async (..._a: unknown[]) => ({
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'historical body' }] }] },
  schemaVersion: 1,
}))

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>()
  return {
    ...actual,
    listVersions: (docId: string, opts?: { kind?: string; cursor?: number | null }) =>
      listVersionsMock(docId, opts),
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

// Item 3: the history is two collapsible streams — manual (named + restore) expanded by default,
// auto snapshots collapsed and lazily fetched. Each stream owns its items / cursor / load-more.
describe('VersionPanel — two-stream groups (item 3)', () => {
  const groupHeader = (root: HTMLElement, key: string) =>
    Array.from(root.querySelectorAll('.octo-version-group-header')).find((b) =>
      b.textContent?.includes(key),
    ) as HTMLButtonElement

  it('renders both group headers with their counts; manual expanded, auto collapsed', async () => {
    render(<VersionPanel docId="d_1" role="admin" />)
    await screen.findByText('docs.version.manualGroup')

    const manual = groupHeader(document.body, 'docs.version.manualGroup')
    const auto = groupHeader(document.body, 'docs.version.autoGroup')
    // Manual count = counts.manual + counts.restore (2 + 1); auto count = counts.auto (5).
    expect(manual.textContent).toContain('(3)')
    expect(auto.textContent).toContain('(5)')
    expect(manual.getAttribute('aria-expanded')).toBe('true')
    expect(auto.getAttribute('aria-expanded')).toBe('false')

    // On mount only the manual stream is fetched (auto is lazy).
    const kinds = listVersionsMock.mock.calls.map((c) => (c[1] as { kind?: string })?.kind)
    expect(kinds).toContain('manual')
    expect(kinds).not.toContain('auto')
  })

  it('lazily fetches the auto stream the first time the auto group is expanded', async () => {
    render(<VersionPanel docId="d_1" role="admin" />)
    await screen.findByText('docs.version.autoGroup')
    expect(listVersionsMock.mock.calls.some((c) => (c[1] as { kind?: string })?.kind === 'auto')).toBe(false)

    fireEvent.click(groupHeader(document.body, 'docs.version.autoGroup'))

    await waitFor(() =>
      expect(listVersionsMock.mock.calls.some((c) => (c[1] as { kind?: string })?.kind === 'auto')).toBe(true),
    )
    // Auto rows show the auto badge + the autosave-time fallback label (empty wire label).
    await screen.findByText('docs.version.badgeAuto')
    expect(screen.getByText('docs.time.autosave')).toBeTruthy()
  })

  it('does not re-fetch the auto stream on a second expand toggle', async () => {
    render(<VersionPanel docId="d_1" role="admin" />)
    await screen.findByText('docs.version.autoGroup')
    const auto = groupHeader(document.body, 'docs.version.autoGroup')
    fireEvent.click(auto) // expand → fetch
    await waitFor(() =>
      expect(listVersionsMock.mock.calls.filter((c) => (c[1] as { kind?: string })?.kind === 'auto').length).toBe(1),
    )
    fireEvent.click(auto) // collapse
    fireEvent.click(auto) // expand again — must reuse the already-loaded stream
    expect(listVersionsMock.mock.calls.filter((c) => (c[1] as { kind?: string })?.kind === 'auto').length).toBe(1)
  })

  it("each group's load-more pages its OWN cursor stream", async () => {
    render(<VersionPanel docId="d_1" role="admin" />)
    await screen.findByText('docs.version.manualGroup')

    // Manual group: load-more uses the manual cursor (100) with kind=manual.
    const manualGroup = document.querySelector('.octo-version-group-manual') as HTMLElement
    const manualMore = Array.from(manualGroup.querySelectorAll('button')).find(
      (b) => b.textContent === 'docs.version.loadMore',
    ) as HTMLButtonElement
    fireEvent.click(manualMore)
    await waitFor(() =>
      expect(
        listVersionsMock.mock.calls.some(
          (c) => (c[1] as { kind?: string; cursor?: number })?.kind === 'manual' && (c[1] as { cursor?: number })?.cursor === 100,
        ),
      ).toBe(true),
    )

    // Expand auto, then its load-more uses the auto cursor (200) with kind=auto.
    fireEvent.click(groupHeader(document.body, 'docs.version.autoGroup'))
    await screen.findByText('docs.version.badgeAuto')
    const autoGroup = document.querySelector('.octo-version-group-auto') as HTMLElement
    const autoMore = Array.from(autoGroup.querySelectorAll('button')).find(
      (b) => b.textContent === 'docs.version.loadMore',
    ) as HTMLButtonElement
    fireEvent.click(autoMore)
    await waitFor(() =>
      expect(
        listVersionsMock.mock.calls.some(
          (c) => (c[1] as { kind?: string; cursor?: number })?.kind === 'auto' && (c[1] as { cursor?: number })?.cursor === 200,
        ),
      ).toBe(true),
    )
  })

  it('previews and restores an auto row (kind-agnostic)', async () => {
    render(<VersionPanel docId="d_1" role="admin" />)
    await screen.findByText('docs.version.autoGroup')
    fireEvent.click(groupHeader(document.body, 'docs.version.autoGroup'))
    await screen.findByText('docs.version.badgeAuto')

    const autoGroup = document.querySelector('.octo-version-group-auto') as HTMLElement
    // Preview the auto row → the shared preview modal opens.
    const autoPreview = Array.from(autoGroup.querySelectorAll('button')).find(
      (b) => b.textContent === 'docs.version.preview',
    ) as HTMLButtonElement
    fireEvent.click(autoPreview)
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeTruthy())
    expect(getVersionStateMock).toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeNull())

    // Restore the auto row → the (kind-agnostic) confirm dialog opens.
    const autoRestore = Array.from(autoGroup.querySelectorAll('button')).find(
      (b) => b.textContent === 'docs.version.restore',
    ) as HTMLButtonElement
    fireEvent.click(autoRestore)
    await waitFor(() => expect(document.querySelector('.octo-version-confirm')).toBeTruthy())
  })
})
