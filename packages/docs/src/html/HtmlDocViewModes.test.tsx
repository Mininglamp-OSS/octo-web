import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import { HtmlDocView } from './HtmlDocView.tsx'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// Integration coverage for the new [页面][代码] mode + 历史版本 mount + diff wiring, on top of the
// existing HtmlDocView.test.tsx render/security suite. Stub the octo-doc backend by URL shape.
function stubFetch(handlers: {
  render?: (url: string) => string
  source?: (url: string) => string
  versions?: unknown
  diff?: unknown
}) {
  const spy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/comments')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [] }) } as unknown as Response)
    if (url.includes('/versions/') && url.includes('/source')) {
      return Promise.resolve({ ok: true, status: 200, text: async () => (handlers.source ? handlers.source(url) : '<p>src</p>') } as unknown as Response)
    }
    if (url.endsWith('/versions')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { versions: handlers.versions ?? [] } }) } as unknown as Response)
    }
    if (url.includes('/diff?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: handlers.diff ?? { from: 1, to: 2, changes: [] } }) } as unknown as Response)
    }
    // render URL /d/{slug}/v/{v}
    return Promise.resolve({ ok: true, status: 200, text: async () => (handlers.render ? handlers.render(url) : '<p>page</p>') } as unknown as Response)
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', spy)
  return spy as unknown as ReturnType<typeof vi.fn>
}

let wk: ReturnType<typeof createMockWKApp>
beforeEach(() => {
  ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
  wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
  setWKApp(wk)
})
afterEach(() => {
  cleanup()
  delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
  setWKApp(undefined as never)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function waitForFrame(container: HTMLElement) {
  return waitFor(() => {
    const f = container.querySelector('iframe.octo-html-doc-frame') as HTMLIFrameElement | null
    expect(f).toBeTruthy()
    return f as HTMLIFrameElement
  })
}

describe('HtmlDocView — page/code mode', () => {
  it('defaults to page mode (iframe) and switches to code mode (source view) on [代码]', async () => {
    stubFetch({ source: () => '<h1>Src</h1>' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="s" version="2" />)
    await waitForFrame(container)
    // Switch to code.
    fireEvent.click(screen.getByText('docs.mode.code'))
    await waitFor(() => expect(screen.getByTestId('html-doc-source')).toBeTruthy())
    // No iframe in code mode; source text is shown.
    expect(container.querySelector('iframe.octo-html-doc-frame')).toBeNull()
    expect(screen.getByTestId('html-doc-source-code').textContent).toContain('<h1>')
  })

  it('hides the comment toggle in code mode and shows a switch-back hint', async () => {
    stubFetch({ source: () => '<p>s</p>' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="s" version="2" />)
    await waitForFrame(container)
    expect(screen.getByTitle('docs.toolbar.comments')).toBeTruthy()
    fireEvent.click(screen.getByText('docs.mode.code'))
    await waitFor(() => screen.getByTestId('html-doc-source'))
    expect(screen.queryByTitle('docs.toolbar.comments')).toBeNull()
    expect(screen.getByText('docs.source.commentHint')).toBeTruthy()
  })

  it('keeps the mode when switching version via 历史版本 查看 (mode is sticky)', async () => {
    stubFetch({
      versions: [{ n: 3 }, { n: 2 }, { n: 1 }],
      source: (u) => (u.includes('/1/') ? '<p>v1 source</p>' : '<p>vN source</p>'),
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="s" version="3" />)
    await waitForFrame(container)
    // Go to code mode.
    fireEvent.click(screen.getByText('docs.mode.code'))
    await waitFor(() => screen.getByTestId('html-doc-source'))
    // Open history and 查看 v1.
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    fireEvent.click(screen.getByText('docs.toolbar.history'))
    await waitFor(() => screen.getByTestId('html-doc-version-panel'))
    const rows = screen.getAllByRole('listitem')
    // v1 is the last row; click its 查看.
    fireEvent.click(rows[2].querySelector('button')!)
    // Still in code mode, now showing v1's source.
    await waitFor(() => expect(screen.getByTestId('html-doc-source-code').textContent).toContain('v1 source'))
    expect(container.querySelector('iframe.octo-html-doc-frame')).toBeNull()
  })
})

describe('HtmlDocView — 历史版本 mount + diff', () => {
  it('opens the version panel from the ≡ menu and lists versions (independent HTML adapter)', async () => {
    stubFetch({ versions: [{ n: 2, created_at: '2026-07-15T04:00:00Z' }, { n: 1 }] })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="s" version="2" />)
    await waitForFrame(container)
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    fireEvent.click(screen.getByText('docs.toolbar.history'))
    await waitFor(() => expect(screen.getByTestId('html-doc-version-panel')).toBeTruthy())
    expect(screen.getAllByRole('listitem').length).toBe(2)
  })

  it('opens the diff modal from 与上一版比较', async () => {
    stubFetch({
      versions: [{ n: 3 }, { n: 2 }],
      diff: { from: 2, to: 3, changes: [] },
      source: () => 'a\nb',
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="s" version="3" />)
    await waitForFrame(container)
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    fireEvent.click(screen.getByText('docs.toolbar.history'))
    await waitFor(() => screen.getByTestId('html-doc-version-panel'))
    // v3 row → 与上一版比较 (compare 2→3).
    const rows = screen.getAllByRole('listitem')
    fireEvent.click(within(rows[0]).getByText('docs.version.comparePrev'))
    await waitFor(() => expect(screen.getByTestId('html-diff-modal')).toBeTruthy())
  })
})
