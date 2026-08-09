import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import { codeHunksToRows, highlightChanges, HtmlDiffModal } from './HtmlDiffModal.tsx'
import type { DiffChange, DiffResult } from './htmlDocSourceApi.ts'

const emptyDiff: DiffResult = {
  from: 2,
  to: 3,
  summary: { added: 0, removed: 0, modified: 0 },
  changes: [],
  code_hunks: [],
}

function stubFetch(handlers: { diff?: DiffResult; render?: (url: string) => string }) {
  const spy = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/diff?')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: handlers.diff ?? emptyDiff }),
      } as Response)
    }
    const body = handlers.render ? handlers.render(url) : '<p>page</p>'
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => body,
    } as Response)
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

describe('server code hunks', () => {
  it('maps unified hunk prefixes and line ranges without source LCS', () => {
    expect(
      codeHunksToRows([
        {
          old_start: 10,
          old_lines: 2,
          new_start: 20,
          new_lines: 2,
          lines: [' context', '-old', '+new'],
        },
      ]),
    ).toEqual([
      {
        op: 'equal',
        oldLine: 10,
        newLine: 20,
        oldText: 'context',
        newText: 'context',
      },
      { op: 'remove', oldLine: 11, oldText: 'old' },
      { op: 'add', newLine: 21, newText: 'new' },
    ])
  })
})

describe('page diff highlighting', () => {
  it('uses before_aid on the old side and after_aid on the new side', () => {
    const change: DiffChange = {
      kind: 'modified',
      before_aid: 'old"aid',
      after_aid: 'new-aid',
      dom_path: '/html[1]/body[1]/p[1]',
      before_path: '/html[1]/body[1]/p[1]',
      after_path: '/html[1]/body[1]/p[1]',
    }
    const oldDoc = new DOMParser().parseFromString('<p data-odoc-aid="old&quot;aid">old</p>', 'text/html')
    const newDoc = new DOMParser().parseFromString('<p data-odoc-aid="new-aid">new</p>', 'text/html')
    expect(highlightChanges(oldDoc, [change], 'old')[0]?.textContent).toBe('old')
    expect(highlightChanges(newDoc, [change], 'new')[0]?.textContent).toBe('new')
  })

  it('falls back from backend DOM paths to safe CSS selectors', () => {
    const doc = new DOMParser().parseFromString('<section><p>first</p><p>target</p></section>', 'text/html')
    const change: DiffChange = {
      kind: 'added',
      dom_path: '/html[1]/body[1]/section[1]/p[2]',
      after_path: '/html[1]/body[1]/section[1]/p[2]',
    }
    expect(highlightChanges(doc, [change], 'new')[0]?.textContent).toBe('target')
  })
})

describe('HtmlDiffModal', () => {
  it('renders the server code hunks and does not fetch version sources', async () => {
    const spy = stubFetch({
      diff: {
        ...emptyDiff,
        code_hunks: [
          {
            old_start: 1,
            old_lines: 1,
            new_start: 1,
            new_lines: 1,
            lines: ['-<p>old</p>', '+<p>new</p>'],
          },
        ],
      },
    })
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    const dialog = await waitFor(() => screen.getByRole('dialog'))
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getAllByRole('tab')).toHaveLength(2)
    expect(within(dialog).getByRole('tab', { name: 'docs.diff.tabCode' }).getAttribute('aria-controls')).toBe(
      'html-diff-panel-code',
    )
    expect(
      within(dialog).getByRole('tabpanel', { hidden: true, name: 'docs.diff.tabCode' }).getAttribute('id'),
    ).toBe('html-diff-panel-code')
    await waitFor(() => screen.getByTestId('html-diff-code-pre'))
    expect(screen.getByTestId('html-diff-code-pre').querySelector('.is-remove')).toBeTruthy()
    expect(screen.getByTestId('html-diff-code-pre').querySelector('.is-add')).toBeTruthy()
    expect(spy.mock.calls.some((call) => String(call[0]).includes('/source'))).toBe(false)
  })

  it('uses roving tab stops and keyboard navigation for diff tabs', async () => {
    stubFetch({})
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    const codeTab = await screen.findByRole('tab', { name: 'docs.diff.tabCode' })
    const pageTab = screen.getByRole('tab', { name: 'docs.diff.tabPage' })
    expect(codeTab.tabIndex).toBe(0)
    expect(pageTab.tabIndex).toBe(-1)

    codeTab.focus()
    fireEvent.keyDown(codeTab, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(pageTab)
    expect(codeTab.tabIndex).toBe(-1)
    expect(pageTab.tabIndex).toBe(0)
    expect(screen.getByRole('tabpanel', { hidden: true, name: 'docs.diff.tabPage' }).hidden).toBe(false)

    fireEvent.keyDown(pageTab, { key: 'Home' })
    expect(document.activeElement).toBe(codeTab)
    fireEvent.keyDown(codeTab, { key: 'End' })
    expect(document.activeElement).toBe(pageTab)
    fireEvent.keyDown(pageTab, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(codeTab)
  })

  it('shows no changes when the server returns no code hunks', async () => {
    stubFetch({})
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('docs.diff.noChanges')).toBeTruthy())
  })

  it('page tab renders both version frames for structural changes', async () => {
    stubFetch({
      diff: {
        ...emptyDiff,
        summary: { added: 0, removed: 0, modified: 1 },
        changes: [
          {
            kind: 'modified',
            before_aid: 'old-aid',
            after_aid: 'new-aid',
            dom_path: '/html[1]/body[1]/p[1]',
            before_path: '/html[1]/body[1]/p[1]',
            after_path: '/html[1]/body[1]/p[1]',
          },
        ],
      },
      render: (url) =>
        url.endsWith('/2') ? '<p data-odoc-aid="old-aid">old</p>' : '<p data-odoc-aid="new-aid">new</p>',
    })
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    fireEvent.click(await screen.findByText('docs.diff.tabPage'))
    await waitFor(() => screen.getByTestId('html-diff-page'))
    expect(screen.getByTestId('html-diff-old')).toBeTruthy()
    expect(screen.getByTestId('html-diff-new')).toBeTruthy()
    expect(screen.getByText('1/1')).toBeTruthy()
  })

  it('switches page layout and closes on Esc/backdrop', async () => {
    stubFetch({})
    const onClose = vi.fn()
    const { container } = render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={onClose} />)
    fireEvent.click(await screen.findByText('docs.diff.tabPage'))
    await waitFor(() => screen.getByTestId('html-diff-page'))
    fireEvent.click(screen.getByText('docs.diff.layoutOld'))
    expect(screen.queryByTestId('html-diff-new')).toBeNull()
    fireEvent.click(screen.getByText('docs.diff.layoutNew'))
    expect(screen.queryByTestId('html-diff-old')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(container.querySelector('.octo-modal-overlay') as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('stops synchronizing scroll after the toggle is disabled', async () => {
    stubFetch({})
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    fireEvent.click(await screen.findByText('docs.diff.tabPage'))
    await waitFor(() => screen.getByTestId('html-diff-page'))
    const frames = screen.getAllByTitle(/Doc · v/) as HTMLIFrameElement[]
    const oldDoc = frames[0].contentDocument!
    const newDoc = frames[1].contentDocument!
    Object.defineProperties(oldDoc.documentElement, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
    })
    Object.defineProperties(newDoc.documentElement, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
    })
    oldDoc.documentElement.scrollTop = 450
    fireEvent.scroll(oldDoc)
    expect(newDoc.documentElement.scrollTop).toBe(450)
    fireEvent.click(screen.getByRole('checkbox', { name: 'docs.diff.syncScroll' }))
    oldDoc.documentElement.scrollTop = 900
    fireEvent.scroll(oldDoc)
    expect(newDoc.documentElement.scrollTop).toBe(450)
  })

  it('traps focus and restores the trigger on close', async () => {
    stubFetch({})
    const trigger = document.createElement('button')
    trigger.textContent = 'trigger'
    document.body.appendChild(trigger)
    trigger.focus()
    const view = render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])')).filter(
      (button) => !button.closest('[hidden]'),
    )
    buttons[buttons.length - 1].focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0])
    buttons[0].focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(buttons[buttons.length - 1])
    view.unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('shows an error for HTTP or contract failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { from: 2, to: 3 } }),
        } as Response),
      ),
    )
    render(<HtmlDiffModal slug="s" from="2" to="3" title="Doc" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText('docs.diff.error')).toBeTruthy()
  })
})
