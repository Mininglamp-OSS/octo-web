import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { HtmlSourceView } from './HtmlSourceView.tsx'

function stubFetch(impl: (url: string, init?: RequestInit) => unknown) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init)),
  ) as unknown as typeof fetch
  vi.stubGlobal('fetch', spy)
  return spy as unknown as ReturnType<typeof vi.fn>
}
function htmlResponse(body: string, ok = true, status = 200): Response {
  return { ok, status, text: async () => body } as unknown as Response
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

describe('HtmlSourceView', () => {
  it('loads the raw source and renders it with per-line numbers', async () => {
    stubFetch(() => htmlResponse('<h1>Title</h1>\n<p>Body</p>'))
    render(<HtmlSourceView slug="src-a" version="1" />)
    const code = await waitFor(() => screen.getByTestId('html-doc-source-code'))
    // Two source lines → line numbers 1 and 2.
    expect(code.querySelectorAll('.octo-src-line')).toHaveLength(2)
    expect(code.querySelector('.octo-src-ln')?.textContent).toBe('1')
    // The raw markup is present as selectable text (browser-searchable, not executed).
    expect(code.textContent).toContain('<h1>')
    expect(code.textContent).toContain('Title')
  })

  it('never renders executable/editable DOM from the source (read-only text only)', async () => {
    stubFetch(() => htmlResponse('<script>window.__x=1</script><button>b</button><input>'))
    const { container } = render(<HtmlSourceView slug="src-safe" version="1" />)
    await waitFor(() => screen.getByTestId('html-doc-source-code'))
    // The tags are shown as TEXT, not live nodes.
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('button.payload')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
    expect(screen.getByTestId('html-doc-source-code').textContent).toContain('<script>')
  })

  it('toggles line wrap', async () => {
    stubFetch(() => htmlResponse('<p>x</p>'))
    render(<HtmlSourceView slug="src-wrap" version="1" />)
    const code = await waitFor(() => screen.getByTestId('html-doc-source-code'))
    expect(code.className).not.toContain('is-wrap')
    fireEvent.click(screen.getByText('docs.source.wrap'))
    expect(screen.getByTestId('html-doc-source-code').className).toContain('is-wrap')
  })

  it('copies the full source via the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    stubFetch(() => htmlResponse('<p>copy me</p>'))
    render(<HtmlSourceView slug="src-copy" version="1" />)
    await waitFor(() => screen.getByTestId('html-doc-source-code'))
    fireEvent.click(screen.getByText('docs.source.copyAll'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('<p>copy me</p>'))
  })

  it('caches by slug:version — a re-mounted identical view does not re-fetch', async () => {
    const spy = stubFetch(() => htmlResponse('<p>cached</p>'))
    const first = render(<HtmlSourceView slug="src-cache" version="7" />)
    await waitFor(() => screen.getByTestId('html-doc-source-code'))
    expect(spy.mock.calls.length).toBe(1)
    first.unmount()
    render(<HtmlSourceView slug="src-cache" version="7" />)
    await waitFor(() => screen.getByTestId('html-doc-source-code'))
    // Served from the module cache, no second network hit.
    expect(spy.mock.calls.length).toBe(1)
  })

  it('re-fetches when the version changes (lazy per version)', async () => {
    const spy = stubFetch((url) => htmlResponse(url.includes('/8/') ? '<p>v8</p>' : '<p>v9</p>'))
    const { rerender } = render(<HtmlSourceView slug="src-ver" version="8" />)
    await waitFor(() => expect(screen.getByTestId('html-doc-source-code').textContent).toContain('v8'))
    rerender(<HtmlSourceView slug="src-ver" version="9" />)
    await waitFor(() => expect(screen.getByTestId('html-doc-source-code').textContent).toContain('v9'))
    expect(spy.mock.calls.length).toBe(2)
  })

  it('shows an error state when the source fetch fails', async () => {
    stubFetch(() => htmlResponse('nope', false, 500))
    render(<HtmlSourceView slug="src-err" version="1" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText('docs.source.error')).toBeTruthy()
  })
})
