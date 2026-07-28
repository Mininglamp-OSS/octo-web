import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import { HtmlDiffModal } from './HtmlDiffModal.tsx'

// The modal talks to the octo-doc backend: GET /diff, GET /versions/{v}/source (code tab) and the
// render URL /d/{slug}/v/{v} for each page-diff frame. Route the stub by URL shape.
function stubFetch(handlers: {
  diff?: unknown
  source?: (url: string) => string
  render?: (url: string) => string
}) {
  const spy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/diff?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: handlers.diff ?? { from: 1, to: 2, changes: [] } }) } as unknown as Response)
    }
    if (url.includes('/source')) {
      const body = handlers.source ? handlers.source(url) : '<p>src</p>'
      return Promise.resolve({ ok: true, status: 200, text: async () => body } as unknown as Response)
    }
    // render URL (page-diff frame)
    const body = handlers.render ? handlers.render(url) : '<p>page</p>'
    return Promise.resolve({ ok: true, status: 200, text: async () => body } as unknown as Response)
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', spy)
  return spy as unknown as ReturnType<typeof vi.fn>
}

beforeEach(() => {
  ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
})
afterEach(() => {
  cleanup()
  delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HtmlDiffModal', () => {
  it('is a semantic dialog with [代码 Diff][页面 Diff] tabs; code tab is default', async () => {
    stubFetch({ source: (u) => (u.includes('/2/') ? 'a\nOLD' : 'a\nNEW') })
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    const dialog = await waitFor(() => screen.getByRole('dialog'))
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const tabs = within(dialog).getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    // Code tab selected by default → code panel present.
    await waitFor(() => expect(screen.getByTestId('html-diff-code')).toBeTruthy())
  })

  it('code diff shows red删 / 绿增 rows from the two raw sources', async () => {
    stubFetch({ source: (u) => (u.includes('/2/') ? 'keep\nold line' : 'keep\nnew line') })
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    await waitFor(() => screen.getByTestId('html-diff-code-pre'))
    const rows = screen.getAllByTestId('diff-row')
    // A changed line becomes a replace row (char emphasis span present).
    const pre = screen.getByTestId('html-diff-code-pre')
    expect(pre.querySelector('.is-replace')).toBeTruthy()
    expect(pre.querySelector('.octo-diff-char')).toBeTruthy()
    expect(rows.length).toBeGreaterThan(0)
  })

  it('code diff toggles 仅看变更 / 显示全部 (context)', async () => {
    // Many equal lines + one change; changes-only hides distant equals.
    const many = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
    stubFetch({ source: (u) => (u.includes('/2/') ? many : many.replace('line10', 'CHANGED10')) })
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    await waitFor(() => screen.getByTestId('html-diff-code-pre'))
    const changesOnlyRows = screen.getAllByTestId('diff-row').length
    // Toggle to show all context → more rows.
    fireEvent.click(screen.getByText('docs.diff.showContext'))
    const allRows = screen.getAllByTestId('diff-row').length
    expect(allRows).toBeGreaterThan(changesOnlyRows)
  })

  it('code diff prefers the backend html_diff when present', async () => {
    stubFetch({
      diff: {
        from: 2,
        to: 3,
        changes: [],
        html_diff: [
          { op: 'equal', old_ln: 1, new_ln: 1, text: '<p>a</p>' },
          { op: 'add', new_ln: 2, text: '<p>b</p>' },
        ],
      },
      source: () => 'unused\nsource',
    })
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    await waitFor(() => screen.getByTestId('html-diff-code-pre'))
    const pre = screen.getByTestId('html-diff-code-pre')
    expect(pre.querySelector('.is-add')).toBeTruthy()
  })

  it('page tab renders two preview frames (旧版/新版) and highlights changed elements by aid', async () => {
    stubFetch({
      diff: { from: 2, to: 3, changes: [{ op: 'replace', aid: 'a5' }] },
      render: () => '<p data-odoc-aid="a5">changed</p>',
    })
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('docs.diff.tabPage'))
    await waitFor(() => screen.getByTestId('html-diff-page'))
    // Both frame columns present in 双栏 default layout.
    expect(screen.getByTestId('html-diff-old')).toBeTruthy()
    expect(screen.getByTestId('html-diff-new')).toBeTruthy()
    // Change navigation shows a 1/1 counter.
    expect(screen.getByText('1/1')).toBeTruthy()
  })

  it('page tab switches layout 双栏/旧版/新版', async () => {
    stubFetch({ diff: { from: 2, to: 3, changes: [] }, render: () => '<p>x</p>' })
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('docs.diff.tabPage'))
    await waitFor(() => screen.getByTestId('html-diff-page'))
    fireEvent.click(screen.getByText('docs.diff.layoutOld'))
    expect(screen.getByTestId('html-diff-old')).toBeTruthy()
    expect(screen.queryByTestId('html-diff-new')).toBeNull()
    fireEvent.click(screen.getByText('docs.diff.layoutNew'))
    expect(screen.getByTestId('html-diff-new')).toBeTruthy()
    expect(screen.queryByTestId('html-diff-old')).toBeNull()
  })

  it('closes on Esc and on backdrop click', async () => {
    stubFetch({ source: () => 'a' })
    const onClose = vi.fn()
    const { container } = render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={onClose} />)
    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(container.querySelector('.octo-modal-overlay') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows an error state when the diff load fails', async () => {
    const spy = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/diff?')) return Promise.resolve({ ok: false, status: 500, json: async () => null } as unknown as Response)
      return Promise.resolve({ ok: true, status: 200, text: async () => 'x' } as unknown as Response)
    }) as unknown as typeof fetch
    vi.stubGlobal('fetch', spy)
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText('docs.diff.error')).toBeTruthy()
  })
})
