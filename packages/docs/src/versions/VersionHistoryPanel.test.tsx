import type { VersionMeta } from './api.ts'
import type { BotDiffHint } from './botEditForThread.ts'
import { StrictMode } from 'react'
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
/** Bot 改前的安全快照。判据见 botEdit.ts:kind='restore-marker' + label 精确命中白名单。 */
const BOT_SNAPSHOT: VersionMeta = {
  docVersionSeq: 7,
  kind: 'restore-marker' as const,
  label: 'Auto-safety before sheet edit',
  createdBy: 'bot_1',
  createdAt: '2026-06-20T09:00:00.000Z',
  sizeBytes: 500,
  schemaVersion: 1,
  restoredFrom: null,
}
const COUNTS = { auto: 5, manual: 2, restore: 1, total: 8 }

/** 显式标注返回类型:不标的话 mock 的签名会被字面量推窄成「只可能是 auto 行」,
 *  往里塞 restore-marker 夹具就类型不符(而运行时完全合法)。 */
type ListResult = { items: VersionMeta[]; nextCursor: number | null; counts: typeof COUNTS }
const defaultListImpl = async (
  _docId: unknown,
  opts?: { kind?: string; cursor?: number | null },
): Promise<ListResult> => {
  if (opts?.cursor != null) return { items: [{ ...AUTO, docVersionSeq: 4 }], nextCursor: null, counts: COUNTS }
  return { items: [NAMED, AUTO], nextCursor: 100, counts: COUNTS }
}
const listVersionsMock = vi.fn(defaultListImpl)
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
    botDiffHint?: BotDiffHint | null
  }> = {},
) {
  const loadPreviewState =
    overrides.loadPreviewState ?? (async (seq: number) => ({ body: `body-${seq}` }))
  return render(
    <VersionHistoryPanel<PreviewState, string>
      docId="d_1"
      botDiffHint={overrides.botDiffHint ?? null}
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
  listVersionsMock.mockReset()
  listVersionsMock.mockImplementation(defaultListImpl)
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

  it('pages the current filter via cursor on load-more and appends the page (no stale error)', async () => {
    renderPanel()
    await screen.findByText('Draft v1')
    expect(document.querySelectorAll('.octo-version-row').length).toBe(2)
    fireEvent.click(btnByText(document.body, 'docs.version.loadMore'))
    await waitFor(() =>
      expect(listVersionsMock.mock.calls.some((c) => (c[1] as { cursor?: number })?.cursor === 100)).toBe(true),
    )
    // The fetched page (seq 4) is appended onto the existing rows — the append path the load-more
    // guard protects. isCurrent() gates both append and errorMore, so no stale error leaks.
    await waitFor(() => expect(document.querySelectorAll('.octo-version-row').length).toBe(3))
    expect(document.body.textContent).not.toContain('docs.version.errorMore')
  })

  it('re-enables Load More after a superseded load-more (no stuck loadingMore deadlock)', async () => {
    // Regression for the P1 flagged on #656: setLoadingMore(false) used to be gated on isCurrent(),
    // so a load-more superseded (by a filter switch / refresh / restore) before its finally ran
    // would skip the reset and wedge loadingMore=true forever — permanently disabling the Load More
    // button. Here we hang the load-more page, supersede it with a primary refresh (docId change →
    // begin()), then release the stale page: its result must be dropped, but loadingMore MUST clear
    // regardless of isCurrent(), so the fresh list's Load More button is enabled, not deadlocked.
    let releaseLoadMore: (() => void) | null = null
    listVersionsMock.mockImplementation(
      async (_docId: unknown, opts?: { kind?: string; cursor?: number | null }) => {
        if (opts?.cursor != null) {
          await new Promise<void>((resolve) => {
            releaseLoadMore = resolve as () => void
          })
          return { items: [{ ...AUTO, docVersionSeq: 4 }], nextCursor: 200, counts: COUNTS }
        }
        return { items: [NAMED, AUTO], nextCursor: 100, counts: COUNTS }
      },
    )
    const Panel = (p: { docId: string }) => (
      <VersionHistoryPanel<PreviewState, string>
        docId={p.docId}
        role="admin"
        loadPreviewState={async (seq: number) => ({ body: `body-${seq}` })}
        renderPreview={(s) => <div data-testid="preview-body">{s.body}</div>}
      />
    )
    const { rerender } = render(<Panel docId="d_1" />)
    await screen.findByText('Draft v1')
    // Kick off load-more; its page request now hangs, so loadingMore stays true and the button
    // is disabled.
    fireEvent.click(btnByText(document.body, 'docs.version.loadMore'))
    await waitFor(() => expect(btnByText(document.body, 'docs.version.loadMore').disabled).toBe(true))
    // Supersede the in-flight follow-up with a primary refresh (docId change → begin()), which
    // makes the hanging load-more's isCurrent() report false.
    rerender(<Panel docId="d_2" />)
    await waitFor(() =>
      expect(listVersionsMock.mock.calls.some((c) => c[0] === 'd_2')).toBe(true),
    )
    // Release the now-stale load-more: its rows are dropped (isCurrent() false), but the finally
    // must still clear loadingMore. Before the fix this reset was gated out and the flag stuck.
    ;(releaseLoadMore as (() => void) | null)?.()
    await waitFor(() => {
      const btn = btnByText(document.body, 'docs.version.loadMore')
      expect(btn).toBeTruthy()
      expect(btn.disabled).toBe(false)
    })
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
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.viewBotDiff'))
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeTruthy())
    const modal = document.querySelector('.docs-version-preview-modal') as HTMLElement
    expect(modal.closest('.octo-modal-overlay')).toBeTruthy()
    expect(modal.getAttribute('role')).toBe('dialog')
    // 行上按钮直接进对比,先切回预览再断言注入的预览视图。
    await waitFor(() => expect(btnByText(modal, 'docs.version.showPreview')).toBeTruthy())
    fireEvent.click(btnByText(modal, 'docs.version.showPreview'))
    await waitFor(() => expect(modal.querySelector('[data-testid="preview-body"]')?.textContent).toBe('body-7'))
    // The host received a real AbortSignal.
    expect(seen[0]).toBeInstanceOf(AbortSignal)
  })

  it('closes on Escape and on overlay click, but not when the dialog body is clicked', async () => {
    renderPanel()
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.viewBotDiff'))
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
    // 行上的「查看 Diff」**直接进对比模式**(见 onPreview 的 startInCompare),所以 diff 先出;
    // 要看快照本身得用弹窗里的「显示预览」切回去。
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.viewBotDiff'))
    const modal = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    await waitFor(() => expect(modal.querySelector('[data-testid="diff-body"]')?.textContent).toBe('body-7|CURRENT'))
    const toggle = btnByText(modal, 'docs.version.showPreview')
    expect(toggle).toBeTruthy()
    fireEvent.click(toggle)
    await waitFor(() => expect(modal.querySelector('[data-testid="preview-body"]')).toBeTruthy())

    cleanup()
    // Without diff (board case): no compare toggle.
    renderPanel('admin', { renderDiff: undefined, getCurrent: undefined })
    await screen.findByText('Draft v1')
    // canCompare 为假 ⇒ 行上不给「查看 Diff」(点了没 diff 可看),退回纯预览。
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
    fireEvent.click(btnByText(rows[0], 'docs.version.viewBotDiff'))
    fireEvent.click(btnByText(rows[1], 'docs.version.viewBotDiff'))
    // The newer request aborted the earlier one on the wire.
    expect(signals.get(7)!.aborted).toBe(true)
    // Resolve the newer one first, then the stale earlier one.
    deferreds.get(6)!({ body: 'body-6' })
    await waitFor(() =>
      // 行上按钮直接进对比模式,所以看 diff-body。这条用例钉的是预览守卫(中止 + 丢弃过期
      // 响应),跟渲染成预览还是 diff 无关。
      expect(document.querySelector('[data-testid="diff-body"]')?.textContent).toBe('body-6|CURRENT'),
    )
    deferreds.get(7)!({ body: 'body-7' })
    // The stale #7 response is discarded — the modal still shows #6.
    await waitFor(() => {})
    expect(document.querySelector('[data-testid="diff-body"]')?.textContent).toBe('body-6|CURRENT')
  })
})

describe('VersionHistoryPanel — mutations & permissions', () => {
  it('restore goes through an in-panel confirm box (not window.confirm) and fires onRestored', async () => {
    const onRestored = vi.fn()
    renderPanel('admin', { onRestored })
    await screen.findByText('Draft v1')
    fireEvent.click(rowMenuItem(document.querySelector('.octo-version-row')!, 'docs.version.restore')!)
    // A centered confirm box appears in-panel.
    const confirm = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    fireEvent.click(btnByText(confirm, 'docs.version.restore'))
    await waitFor(() => expect(restoreVersionMock).toHaveBeenCalled())
    await waitFor(() => expect(onRestored).toHaveBeenCalled())
  })

  it('delete goes through the same in-panel confirm box (not window.confirm)', async () => {
    // P2 (XIN-848): delete used a native window.confirm; it now uses the unified in-panel confirm
    // box like restore. Guard against a regression to the native dialog and confirm the row is
    // removed only after the box's confirm is clicked.
    const confirmSpy = vi.spyOn(window, 'confirm')
    renderPanel('admin')
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.delete'))
    // No native dialog; a centered in-panel confirm box appears instead.
    expect(confirmSpy).not.toHaveBeenCalled()
    const box = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    fireEvent.click(btnByText(box, 'docs.version.delete'))
    await waitFor(() => expect(deleteVersionMock).toHaveBeenCalledWith('d_1', 7))
    confirmSpy.mockRestore()
  })

  it('renders the confirm box in a fixed viewport-centered overlay (stays visible on long scrolled lists)', async () => {
    // Regression for XIN-867: the in-panel confirm box used to render at the end of the panel's
    // content flow (after the version list) with only box-model styling and no positioning, so on a
    // long, scrolled list it fell below the fold — users clicked delete/restore and never saw the
    // confirm. It now renders inside the shared .octo-modal-overlay (position: fixed; inset: 0), the
    // same viewport-anchored overlay the preview/diff modal uses, so it is always on-screen and its
    // buttons clickable regardless of scroll. jsdom does not compute layout, so we assert the overlay
    // structure (which pins the fixed positioning) rather than measured coordinates, and verify the
    // overlay-click / Esc cancel paths that match the preview modal.
    renderPanel('admin')
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.delete'))
    const box = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    // The confirm card is wrapped by the fixed viewport overlay, not left inline in the panel flow.
    const overlay = box.closest('.octo-modal-overlay') as HTMLElement
    expect(overlay).toBeTruthy()
    expect(box.getAttribute('role')).toBe('dialog')
    expect(box.getAttribute('aria-modal')).toBe('true')
    // Clicking the card body does not dismiss (stopPropagation); clicking the overlay backdrop does.
    fireEvent.mouseDown(box)
    expect(document.querySelector('.octo-version-confirm')).toBeTruthy()
    fireEvent.mouseDown(overlay)
    await waitFor(() => expect(document.querySelector('.octo-version-confirm')).toBeNull())
    // Reopen and confirm Escape cancels too (mirrors the preview modal).
    fireEvent.click(rowMenuItem(document.querySelector('.octo-version-row')!, 'docs.version.restore')!)
    await waitFor(() => expect(document.querySelector('.octo-version-confirm')).toBeTruthy())
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.octo-version-confirm')).toBeNull())
  })

  it('vertically-centers the confirm overlay via a scoped modifier the preview/diff overlay does not carry', async () => {
    // Regression for XIN-887 (decision #2): the confirm card must sit centered in the viewport, not
    // top-anchored like the preview/diff modal. The base .octo-modal-overlay is top-anchored (it can
    // hold taller-than-viewport preview content that scrolls from the top), so the confirm overlay
    // opts into centering with the scoped .octo-modal-overlay--center modifier. jsdom does not compute
    // layout, so we assert the class contract: the confirm overlay carries the modifier and the
    // preview overlay does not, keeping the two behaviors isolated.
    renderPanel('admin', { loadPreviewState: async (seq) => ({ body: `body-${seq}` }) })
    await screen.findByText('Draft v1')

    // Delete confirm overlay is centered.
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.delete'))
    let box = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    expect(box.closest('.octo-modal-overlay')!.classList.contains('octo-modal-overlay--center')).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.octo-version-confirm')).toBeNull())

    // Restore confirm overlay is centered too.
    fireEvent.click(rowMenuItem(document.querySelector('.octo-version-row')!, 'docs.version.restore')!)
    box = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    expect(box.closest('.octo-modal-overlay')!.classList.contains('octo-modal-overlay--center')).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('.octo-version-confirm')).toBeNull())

    // Preview/diff overlay keeps its top-anchored (non-centered) behavior — no modifier.
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.viewBotDiff'))
    const modal = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    expect(modal.closest('.octo-modal-overlay')!.classList.contains('octo-modal-overlay--center')).toBe(false)
  })

  it('does not dismiss the confirm overlay on backdrop-click or Escape while a restore is in flight (busy guard)', async () => {
    // The overlay-click and Escape cancel paths both no-op while a mutation is running, so a stray
    // backdrop click or keypress cannot tear the confirm down mid-request. Hold the restore mutation
    // open to keep the panel busy, then assert both dismissals are ignored until it settles.
    let release!: (v: { newDocVersionSeq: number; restoredFrom: number }) => void
    restoreVersionMock.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = resolve
      }),
    )
    renderPanel('admin')
    await screen.findByText('Draft v1')
    fireEvent.click(rowMenuItem(document.querySelector('.octo-version-row')!, 'docs.version.restore')!)
    const box = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    const overlay = box.closest('.octo-modal-overlay') as HTMLElement

    // Trigger the restore → busy is now true (mutation pending).
    fireEvent.click(btnByText(box, 'docs.version.restore'))
    await waitFor(() => expect(restoreVersionMock).toHaveBeenCalled())

    // Backdrop click and Escape are both no-ops while busy.
    fireEvent.mouseDown(overlay)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('.octo-version-confirm')).toBeTruthy()

    // Once the mutation settles, the confirm clears on its own.
    release({ newDocVersionSeq: 9, restoredFrom: 7 })
    await waitFor(() => expect(document.querySelector('.octo-version-confirm')).toBeNull())
  })

  it('renames a named version inline (no native prompt)', async () => {
    renderPanel('admin')
    await screen.findByText('Draft v1')
    const row = document.querySelector('.octo-version-row-named') as HTMLElement
    fireEvent.click(rowMenuItem(row, 'docs.version.rename')!)
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
    expect(rowMenuItem(row, 'docs.version.restore')).toBeUndefined()
    expect(btnByText(row, 'docs.version.delete')).toBeUndefined()
    expect(rowMenuItem(row, 'docs.version.rename')).toBeUndefined()
    // Preview stays available to readers.
    expect(btnByText(row, 'docs.version.viewBotDiff')).toBeTruthy()
  })

  it('writer can save + rename but cannot restore/delete', async () => {
    renderPanel('writer')
    await screen.findByText('Draft v1')
    expect(btnByText(document.body, 'docs.version.saveCurrent')).toBeTruthy()
    const row = document.querySelector('.octo-version-row-named') as HTMLElement
    expect(rowMenuItem(row, 'docs.version.rename')).toBeTruthy()
    expect(rowMenuItem(row, 'docs.version.restore')).toBeUndefined()
    expect(btnByText(row, 'docs.version.delete')).toBeUndefined()
  })
})

describe('VersionHistoryPanel — StrictMode liveness (mounted-ref re-arm)', () => {
  it('finishes a mutation after a StrictMode double-mount (mounted ref stays live)', async () => {
    // React 18 StrictMode (dev) runs an effect mount → cleanup → remount on the same node. The
    // abort/cleanup effect flips the `mounted` liveness ref to false on cleanup; unless the effect
    // body re-arms it to true on every (re)mount, the ref stays false for the real mount's whole
    // lifetime and every mutation handler early-returns after its await — the trailing state reset
    // (busy=false / confirm cleared) never runs and the panel freezes with buttons stuck busy.
    // This pins that the delete confirm box closes once the delete resolves, which only happens
    // while the liveness ref is true through the double-mount.
    render(
      <StrictMode>
        <VersionHistoryPanel<PreviewState, string>
          docId="d_1"
          role="admin"
          loadPreviewState={async (seq: number) => ({ body: `body-${seq}` })}
          renderPreview={(s) => <div data-testid="preview-body">{s.body}</div>}
        />
      </StrictMode>,
    )
    await screen.findByText('Draft v1')
    fireEvent.click(btnByText(document.querySelector('.octo-version-row')!, 'docs.version.delete'))
    const box = await waitFor(() => document.querySelector('.octo-version-confirm') as HTMLElement)
    fireEvent.click(btnByText(box, 'docs.version.delete'))
    await waitFor(() => expect(deleteVersionMock).toHaveBeenCalledWith('d_1', 7))
    // Re-armed: onDelete runs past its `if (!mounted.current) return` gate → setConfirmDelete(null)
    // closes the box. Gated (no re-arm): ref stuck false → early return → the box never closes.
    await waitFor(() => expect(document.querySelector('.octo-version-confirm')).toBeNull())
  })
})

describe('VersionHistoryPanel — 对比弹窗里的「撤销本次修改」', () => {
  // 用户实测报的:表格点「查看 Diff」看到了 Bot 改了什么,却没有撤销入口。文档侧走
  // renderBotDiff(BotEditDiffView 自带撤销),表格没有那个视图、走通用对比弹窗,于是缺口
  // 只出现在这条退路上。
  it('offers revert on a bot snapshot when the host has no renderBotDiff', async () => {
    listVersionsMock.mockImplementation(async () => ({ items: [BOT_SNAPSHOT], nextCursor: null, counts: COUNTS }))
    renderPanel('admin')
    const botRow = await waitFor(() => {
      const r = document.querySelector('.octo-version-row.is-bot-edit') as HTMLElement
      expect(r).toBeTruthy()
      return r
    })
    fireEvent.click(btnByText(botRow, 'docs.version.viewBotDiff'))
    const modal = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    const revert = btnByText(modal, 'docs.botDiff.revertAll')
    expect(revert).toBeTruthy()

    // 点它要走**现成的**恢复确认流程,而不是直接发请求。先关预览再开确认框,否则确认框
    // 会被压在预览浮层下面。
    fireEvent.click(revert)
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeNull())
    await waitFor(() => expect(btnByText(document.body, 'docs.version.restore')).toBeTruthy())
  })

  it('does not offer revert on a non-bot version', async () => {
    // 普通版本的「恢复」是另一件事(回到某个旧版本),不该顶着「撤销 Bot 本次修改」的名字。
    renderPanel('admin')
    await screen.findByText('Draft v1')
    const plainRow = Array.from(document.querySelectorAll('.octo-version-row')).find(
      (r) => !r.classList.contains('is-bot-edit'),
    ) as HTMLElement
    fireEvent.click(btnByText(plainRow, 'docs.version.viewBotDiff'))
    const modal = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    expect(btnByText(modal, 'docs.botDiff.revertAll')).toBeUndefined()
  })

  it('hides revert from a role that cannot restore', async () => {
    listVersionsMock.mockImplementation(async () => ({ items: [BOT_SNAPSHOT], nextCursor: null, counts: COUNTS }))
    renderPanel('writer')
    const botRow = await waitFor(() => {
      const r = document.querySelector('.octo-version-row.is-bot-edit') as HTMLElement
      expect(r).toBeTruthy()
      return r
    })
    fireEvent.click(btnByText(botRow, 'docs.version.viewBotDiff'))
    const modal = await waitFor(() => document.querySelector('.docs-version-preview-modal') as HTMLElement)
    expect(btnByText(modal, 'docs.botDiff.revertAll')).toBeUndefined()
  })
})

describe('VersionHistoryPanel — botDiffHint 自动打开对应 Diff', () => {
  // 用户实测:评论卡片上的按钮只是把人送到版本记录,得自己再找一遍。带上「Bot + 根评论→回复
  // 的时间窗」就能直接打开 —— 但只在唯一命中时,否则会把别人的改动展示成这条评论的结果。
  const HINT = { botUid: 'bot_1', fromISO: '2026-08-07T09:59:00.000Z', toISO: '2026-08-07T10:01:00.000Z' }

  it('opens the matching bot diff by itself', async () => {
    const snap = { ...BOT_SNAPSHOT, createdBy: 'bot_1', createdAt: '2026-08-07T10:00:00.000Z' }
    listVersionsMock.mockImplementation(async () => ({ items: [snap], nextCursor: null, counts: COUNTS }))
    renderPanel('admin', { botDiffHint: HINT })
    // 直接出对比弹窗,不用点任何按钮。
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeTruthy())
  })

  it('does NOT auto-open when two snapshots match the window', async () => {
    // 一条串里被追问多次就会这样。哪一次对应用户此刻问的那句分不出来,所以停在列表上。
    const a = { ...BOT_SNAPSHOT, docVersionSeq: 7, createdBy: 'bot_1', createdAt: '2026-08-07T09:59:30.000Z' }
    const b = { ...BOT_SNAPSHOT, docVersionSeq: 9, createdBy: 'bot_1', createdAt: '2026-08-07T10:00:30.000Z' }
    listVersionsMock.mockImplementation(async () => ({ items: [a, b], nextCursor: null, counts: COUNTS }))
    renderPanel('admin', { botDiffHint: HINT })
    await waitFor(() => expect(document.querySelectorAll('.octo-version-row').length).toBe(2))
    expect(document.querySelector('.docs-version-preview-modal')).toBeNull()
  })

  it('does not re-open after the user closes it', async () => {
    // 自动打开只做一次。不加闩的话下一次列表刷新(轮询/分页)会把它又弹出来 —— 关不掉的弹窗。
    const snap = { ...BOT_SNAPSHOT, createdBy: 'bot_1', createdAt: '2026-08-07T10:00:00.000Z' }
    listVersionsMock.mockImplementation(async () => ({ items: [snap], nextCursor: null, counts: COUNTS }))
    renderPanel('admin', { botDiffHint: HINT })
    // waitFor 的回调里必须有断言才会重试;只 return querySelector 的话第一次拿到 null 就结束了。
    const modal = await waitFor(() => {
      const m = document.querySelector('.docs-version-preview-modal') as HTMLElement
      expect(m).toBeTruthy()
      return m
    })
    fireEvent.click(btnByText(modal, 'docs.version.close'))
    await waitFor(() => expect(document.querySelector('.docs-version-preview-modal')).toBeNull())
    // 触发一次列表刷新:切筛选页签。
    fireEvent.click(btnByText(document.body, 'docs.version.filterAuto'))
    await waitFor(() => expect(listVersionsMock.mock.calls.length).toBeGreaterThan(1))
    expect(document.querySelector('.docs-version-preview-modal')).toBeNull()
  })
})
