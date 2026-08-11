import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

// XIN-840: the doc VersionPanel is now a THIN ADAPTER over the unified <VersionHistoryPanel>. The
// shell's own behavior (list / filter / counts / load-more, the preview modal machine, race guard,
// mutations, role gating) is pinned by VersionHistoryPanel.test.tsx. These tests pin only the
// doc-specific wiring the adapter injects: it renders the shell as a single mixed list, loads a
// preview via getVersionState (decoded PM-JSON → throwaway-editor preview), and compares a version
// against the live editor's JSON through the real block-level diff.

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

const HISTORICAL_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'historical body' }] }],
}

const listVersionsMock = vi.fn(
  async (_docId: unknown, opts?: { kind?: string; cursor?: number | null }) => {
    if (opts?.cursor != null) return { items: [{ ...AUTO, docVersionSeq: 4 }], nextCursor: null, counts: COUNTS }
    return { items: [NAMED, AUTO], nextCursor: 100, counts: COUNTS }
  },
)
const getVersionStateMock = vi.fn(async (..._a: unknown[]) => ({
  doc: HISTORICAL_DOC,
  schemaVersion: 1,
  docVersionSeq: 7,
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

/** A live editor whose JSON is the "current" side of a diff (read-only in the panel). */
function fakeEditor(text: string): Editor {
  return {
    getJSON: () => ({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }),
  } as unknown as Editor
}

const btnByText = (root: ParentNode, text: string) =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement

/**
 * 恢复 / 重命名已经从行上挪进右键菜单(行上只留「查看 Diff」+「删除」),所以要先右键。
 * 只改「怎么拿到那个按钮」,权限矩阵的断言含义未变。
 */
const openRowMenu = (row: Element) => fireEvent.contextMenu(row)
const rowMenuItem = (row: Element, text: string) => {
  openRowMenu(row)
  return Array.from(document.querySelectorAll('.octo-comment-ctx-item')).find(
    (b) => b.textContent === text,
  ) as HTMLButtonElement | undefined
}

beforeEach(() => {
  listVersionsMock.mockClear()
  getVersionStateMock.mockClear()
})
afterEach(() => cleanup())

describe('VersionPanel — thin adapter over VersionHistoryPanel', () => {
  it('renders the shell as a single mixed list (kind="all") with the unified counts header', async () => {
    render(<VersionPanel docId="d_1" role="admin" />)
    await screen.findByText('Draft v1')
    // One flat list, not two collapsible group headers.
    expect(document.querySelectorAll('.octo-version-list .octo-version-row').length).toBe(2)
    expect(document.querySelector('.octo-version-group-manual')).toBeNull()
    expect(document.querySelector('.octo-version-group-auto')).toBeNull()
    // The shell requests the merged stream on mount.
    expect((listVersionsMock.mock.calls[0][1] as { kind?: string }).kind).toBe('all')
    // Counts header: manual(2)+restore(1)=3 · auto=5.
    const counts = document.querySelector('.octo-version-counts') as HTMLElement
    expect(counts.textContent).toContain('3')
    expect(counts.textContent).toContain('5')
  })

  it('exposes the doc filter tabs and reloads with the chosen kind', async () => {
    render(<VersionPanel docId="d_1" role="admin" />)
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.body, 'docs.version.filterAuto'))
    await waitFor(() =>
      expect(listVersionsMock.mock.calls.some((c) => (c[1] as { kind?: string })?.kind === 'auto')).toBe(true),
    )
  })

  it('previews a version through getVersionState and renders the throwaway-editor preview', async () => {
    render(<VersionPanel docId="d_1" role="admin" />)
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.viewBotDiff'))
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeTruthy())
    // Loaded via GET /versions/:seq/state for the clicked row (docId + seq forwarded).
    expect(getVersionStateMock).toHaveBeenCalled()
    expect(getVersionStateMock.mock.calls[0][0]).toBe('d_1')
    expect(getVersionStateMock.mock.calls[0][1]).toBe(7)
    const modal = document.querySelector('.docs-version-preview-modal') as HTMLElement
    // 行上的「查看 Diff」直接进对比模式;这条断言的是一次性编辑器渲染的**预览**,先切回去。
    await waitFor(() => expect(btnByText(modal, 'docs.version.showPreview')).toBeTruthy())
    fireEvent.click(btnByText(modal, 'docs.version.showPreview'))
    await waitFor(() =>
      expect(modal.querySelector('[data-testid="version-preview-content"]')).toBeTruthy(),
    )
  })

  it('compares a version against the live editor JSON via the block-level diff', async () => {
    render(<VersionPanel docId="d_1" role="admin" editor={fakeEditor('current body')} />)
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.viewBotDiff'))
    const modal = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    // 行上的「查看 Diff」**已经**是对比模式了(不用再点 compare 切进去),真 DiffView 直接渲染
    // 历史版本 vs 当前正文的块级 diff。
    await waitFor(() => expect(modal.querySelector('.octo-version-diff')).toBeTruthy())
    const diff = modal.querySelector('.octo-version-diff') as HTMLElement
    // 'historical body' → 'current body' is a single changed block.
    expect(diff.querySelector('.octo-diff-removed')?.textContent).toContain('historical body')
    expect(diff.querySelector('.octo-diff-added')?.textContent).toContain('current body')
  })
})
