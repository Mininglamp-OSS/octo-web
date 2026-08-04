import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import {
  HtmlDocView,
  resolveOctoDocBase,
  buildOctoDocUrl,
  sanitizeDocHtml,
  absolutizeDocAssetUrls,
  resolveHtmlDocAnchorText,
  injectBaseHref,
} from './HtmlDocView.tsx'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// HtmlDocView fetches the published octo-doc HTML from a SEPARATE backend, so we stub the
// global fetch (not the octoweb apiClient) — mirroring the component's raw-fetch design.
function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(impl(String(input), init))
  ) as unknown as typeof fetch
  vi.stubGlobal('fetch', spy)
  return spy as unknown as ReturnType<typeof vi.fn>
}

function htmlResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => body,
  } as unknown as Response
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

// The iframe now runs with sandbox="allow-scripts" (NO allow-same-origin), so the parent can no
// longer read contentDocument or attach a selectionchange listener to it. Selection/anchor data
// crosses the boundary over the postMessage bridge (htmlDocBridge). These helpers simulate the
// in-frame bridge script by posting bridge-shaped messages with source === the frame's
// contentWindow (the exact identity check HtmlDocView enforces).
import { BRIDGE_CHANNEL, type BridgeAnchor } from './htmlDocBridge.ts'

// The parent gates bridge traffic on a per-render token embedded in the srcDoc bridge script
// (TOKEN = "..."). Tests read it back out so simulated frame messages echo the current generation.
function frameToken(iframe: HTMLIFrameElement): string {
  const src = iframe.getAttribute('srcdoc') ?? ''
  const m = /TOKEN = "([^"]*)"/.exec(src)
  return m ? m[1] : ''
}

function postBridge(iframe: HTMLIFrameElement, data: Record<string, unknown>) {
  // jsdom won't let us set MessageEvent.source to an arbitrary Window, so define it directly to
  // match the frame's contentWindow — the value HtmlDocView compares event.source against.
  const token = 'token' in data ? data.token : frameToken(iframe)
  const ev = new MessageEvent('message', { data: { channel: BRIDGE_CHANNEL, token, ...data } })
  Object.defineProperty(ev, 'source', { value: iframe.contentWindow, configurable: true })
  window.dispatchEvent(ev)
}

/** Simulate the in-frame bridge reporting a selection anchor (or null to clear). */
function bridgeSelection(iframe: HTMLIFrameElement, anchor: BridgeAnchor | null) {
  postBridge(iframe, { type: 'selection', anchor })
}

/**
 * Stand in for the in-frame bridge answering element-text lookups. Intercepts the parent's
 * postMessage request to the frame, reads its nonce, and posts back the matching anchor-text
 * reply (source === contentWindow, echoing the request token). Returns a restore fn.
 */
function autoAnswerAnchorText(iframe: HTMLIFrameElement, textByAid: Record<string, string | null>) {
  const win = iframe.contentWindow as Window
  const orig = win.postMessage.bind(win)
  win.postMessage = ((msg: unknown) => {
    const m = msg as { channel?: string; type?: string; nonce?: string; aid?: string; token?: string }
    if (m && m.channel === BRIDGE_CHANNEL && m.type === 'resolve-anchor-text' && m.nonce && m.aid) {
      const text = m.aid in textByAid ? textByAid[m.aid] : null
      postBridge(iframe, { type: 'anchor-text', token: m.token, nonce: m.nonce, text })
    }
  }) as typeof win.postMessage
  return () => {
    win.postMessage = orig
  }
}

async function waitForFrame(container: HTMLElement): Promise<HTMLIFrameElement> {
  return waitFor(() => {
    const frame = container.querySelector('iframe.octo-html-doc-frame') as HTMLIFrameElement | null
    expect(frame).toBeTruthy()
    return frame as HTMLIFrameElement
  })
}

beforeEach(() => {
  delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
  ;(window as unknown as { __OCTO_HTML_SOURCE_DIFF_ENABLED__?: boolean }).__OCTO_HTML_SOURCE_DIFF_ENABLED__ = true
})

afterEach(() => {
  delete (window as unknown as { __OCTO_HTML_SOURCE_DIFF_ENABLED__?: unknown }).__OCTO_HTML_SOURCE_DIFF_ENABLED__
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveOctoDocBase / buildOctoDocUrl', () => {
  it('prefers the runtime window.__OCTO_DOC_BASE__ override (trailing slash trimmed)', () => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://octo-doc.example.com/'
    expect(resolveOctoDocBase()).toBe('https://octo-doc.example.com')
  })

  it('defaults to the same-origin /docs-html unified prefix when nothing is configured', () => {
    expect(resolveOctoDocBase()).toBe('/docs-html')
  })

  it('builds the octo-doc read-only URL `<base>/d/{slug}/v/{version}`', () => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
    expect(buildOctoDocUrl('my-slug', 'v3')).toBe('https://od.test/d/my-slug/v/v3')
  })
})

describe('absolutizeDocAssetUrls', () => {
  it('absolutizes root octo-doc img asset URLs and preserves signed query params', () => {
    const out = absolutizeDocAssetUrls(
      '<!doctype html><html><body><img src="/d/slug/assets/a.png?sig=s1&exp=9"></body></html>',
      'https://od.test/d/slug/v/latest'
    )
    expect(out).toContain('src="https://od.test/d/slug/assets/a.png?sig=s1&amp;exp=9"')
  })

  it('absolutizes relative asset URLs against the real document URL', () => {
    const out = absolutizeDocAssetUrls(
      '<html><head><link rel="stylesheet" href="assets/doc.css?sig=s"></head><body><img src="./assets/a.png"><img src="../assets/b.png?exp=9"></body></html>',
      'https://od.test/d/slug/v/latest'
    )
    expect(out).toContain('href="https://od.test/d/slug/v/assets/doc.css?sig=s"')
    expect(out).toContain('src="https://od.test/d/slug/v/assets/a.png"')
    expect(out).toContain('src="https://od.test/d/slug/assets/b.png?exp=9"')
  })

  it('re-roots root-relative /d/ octo-doc assets under the same-origin /docs-html prefix (DEFAULT deploy)', () => {
    // DEFAULT deploy: no override, resolveOctoDocBase() === '/docs-html'. The doc backend emits
    // root-relative refs like /d/{slug}/assets/{sha}; without re-rooting they resolve against the
    // page origin, DROP the /docs-html prefix, and 404 (the nginx only proxies /docs-html/*).
    expect(resolveOctoDocBase()).toBe('/docs-html')
    const out = absolutizeDocAssetUrls(
      '<!doctype html><html><body><img src="/d/slug/assets/a.png?sig=s1&exp=9"></body></html>',
      // same-origin default docUrl form: {origin}/docs-html/d/{slug}/v/{ver}
      'http://localhost/docs-html/d/slug/v/latest'
    )
    expect(out).toContain('src="http://localhost/docs-html/d/slug/assets/a.png?sig=s1&amp;exp=9"')
    expect(out).not.toContain('src="http://localhost/d/slug/assets/a.png')
  })

  it('does not double-prefix an asset already under /docs-html/d/', () => {
    const out = absolutizeDocAssetUrls(
      '<!doctype html><html><body><img src="/docs-html/d/slug/assets/a.png"></body></html>',
      'http://localhost/docs-html/d/slug/v/latest'
    )
    expect(out).toContain('src="http://localhost/docs-html/d/slug/assets/a.png"')
    expect(out).not.toContain('/docs-html/docs-html/')
  })

  it('leaves already absolute asset URLs and ordinary relative links untouched', () => {
    const out = absolutizeDocAssetUrls(
      '<html><head><link href="https://cdn.test/d/slug/assets/doc.css"></head><body><img src="/other/image.png"><a href="chapter.html">next</a></body></html>',
      'https://od.test/d/slug/v/latest'
    )
    expect(out).toContain('href="https://cdn.test/d/slug/assets/doc.css"')
    expect(out).toContain('src="/other/image.png"')
    expect(out).toContain('href="chapter.html"')
  })

  it('neutralizes editable controls without removing their display markup', () => {
    const out = absolutizeDocAssetUrls(
      '<html><body><p>plain text remains</p><form><input value="x"><button>go</button><textarea>t</textarea><select><option>o</option></select></form><div contenteditable="true">edit me</div></body></html>',
      'https://od.test/d/slug/v/latest'
    )
    expect(out).toContain('plain text remains')
    expect(out).toContain('<input value="x" disabled="">')
    expect(out).toContain('<button disabled="">go</button>')
    expect(out).toContain('<textarea disabled="">t</textarea>')
    expect(out).toContain('<select disabled="">')
    expect(out).toContain('contenteditable="false"')
    expect(out).not.toContain('contenteditable="true"')
  })
})

describe('resolveHtmlDocAnchorText', () => {
  it('returns text anchors directly and null for doc-level anchors', () => {
    const doc = new DOMParser().parseFromString('<p>unused</p>', 'text/html')

    expect(resolveHtmlDocAnchorText({ kind: 'text', text: 'selected source' }, doc)).toBe('selected source')
    expect(resolveHtmlDocAnchorText(null, doc)).toBeNull()
  })

  it('reads element anchor text by data-odoc-aid and trims it', () => {
    const doc = new DOMParser().parseFromString('<p data-odoc-aid="a7">  Anchored paragraph text.  </p>', 'text/html')

    expect(
      resolveHtmlDocAnchorText(
        {
          kind: 'element',
          aid: 'a7',
          selector: '[data-odoc-aid="a7"]',
          label: 'p',
        },
        doc
      )
    ).toBe('Anchored paragraph text.')
  })

  it('truncates long element anchor text to a short excerpt', () => {
    const longText = 'a'.repeat(121)
    const doc = new DOMParser().parseFromString(`<p data-odoc-aid="long">${longText}</p>`, 'text/html')

    const out = resolveHtmlDocAnchorText(
      {
        kind: 'element',
        aid: 'long',
        selector: '[data-odoc-aid="long"]',
        label: 'p',
      },
      doc
    )

    expect(out).toBe(`${'a'.repeat(120)}…`)
  })

  it('returns null when an element anchor cannot be resolved', () => {
    const doc = new DOMParser().parseFromString('<p data-odoc-aid="a1">x</p>', 'text/html')

    expect(
      resolveHtmlDocAnchorText(
        {
          kind: 'element',
          aid: 'missing',
          selector: '[data-odoc-aid="missing"]',
          label: 'p',
        },
        doc
      )
    ).toBeNull()
    expect(
      resolveHtmlDocAnchorText(
        {
          kind: 'element',
          aid: 'a1',
          selector: '[data-odoc-aid="a1"]',
          label: 'p',
        },
        null
      )
    ).toBeNull()
  })

  it('safely resolves a hostile data-odoc-aid (selector metacharacters) without throwing', () => {
    // The aid carries a quote+bracket that would break a naive attribute selector; escaping must
    // neutralize it. The matching element resolves; a non-matching hostile aid returns null.
    const hostile = '"] , script'
    const doc = new DOMParser().parseFromString(
      `<p data-odoc-aid='${hostile}'>hostile text</p>`,
      'text/html'
    )
    expect(() =>
      resolveHtmlDocAnchorText({ kind: 'element', aid: hostile, selector: 'x', label: 'p' }, doc)
    ).not.toThrow()
    expect(resolveHtmlDocAnchorText({ kind: 'element', aid: hostile, selector: 'x', label: 'p' }, doc)).toBe('hostile text')
    expect(
      resolveHtmlDocAnchorText({ kind: 'element', aid: '"] , [x], nope', selector: 'x', label: 'p' }, doc)
    ).toBeNull()
  })
})

describe('HtmlDocView — read-only rendering', () => {
  it('renders the published octo-doc HTML in a sandboxed iframe (fetched from the octo-doc backend)', async () => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
    const spy = stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<h1>Agent Report</h1><p style="color:red">Generated content.</p>')
    })

    const { container } = render(<HtmlDocView docId="d_html_1" space="sp" />)

    const frame = await waitForFrame(container)
    // allow-scripts WITHOUT allow-same-origin: doc JS runs but is walled off from the parent.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.getAttribute('srcdoc')).toContain('Agent Report')
    expect(frame.getAttribute('srcdoc')).toContain('style="color:red"')
    expect(container.querySelector('.octo-html-doc-content')).toBeNull()
    // Addressed the octo-doc read-only surface, not the /api/v1 docs backend.
    expect(String(spy.mock.calls[0][0])).toBe('https://od.test/d/d_html_1/v/latest')
    // Cross-origin session cookie must ride along.
    expect(spy.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
  })

  it('uses an explicit slug + version when provided', async () => {
    const spy = stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<p>ok</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="published-slug" version="v7" />)
    await waitForFrame(container)
    expect(String(spy.mock.calls[0][0])).toBe('/docs-html/d/published-slug/v/v7')
  })

  it('shows a loading state before the fetch resolves', async () => {
    let resolve!: (r: Response) => void
    stubFetch(() => new Promise<Response>((r) => (resolve = r)))
    render(<HtmlDocView docId="d1" space="sp" />)
    // Loading placeholder present while pending.
    expect(screen.getByRole('status')).toBeTruthy()
    resolve(htmlResponse('<p>done</p>'))
    await waitFor(() => expect(document.querySelector('iframe.octo-html-doc-frame')).toBeTruthy())
  })

  it('shows an error state when the fetch fails (non-ok)', async () => {
    stubFetch(() => htmlResponse('nope', false, 500))
    render(<HtmlDocView docId="d1" space="sp" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  })

  it('shows an error state when the fetch rejects (network)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))) as unknown as typeof fetch)
    render(<HtmlDocView docId="d1" space="sp" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  })

  it('shows an empty state when octo-doc returns blank HTML', async () => {
    stubFetch(() => htmlResponse('   '))
    render(<HtmlDocView docId="d1" space="sp" />)
    await waitFor(() => expect(screen.getByText('docs.state.empty')).toBeTruthy())
  })

  it('is READ-ONLY: renders no editing controls in the host document body', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<h1>Title</h1><button>payload button</button><input value="payload">')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)

    const main = screen.getByTestId('html-doc-main')
    expect(main.querySelector('iframe.octo-html-doc-frame')).toBeTruthy()
    expect(main.querySelector('.octo-html-doc-content')).toBeNull()
    expect(container.querySelector('.ProseMirror')).toBeNull()
    expect(container.querySelector('[role="toolbar"]')).toBeNull()
  })

  it('keeps raw HTML in srcdoc and runs it only under the allow-scripts (no same-origin) sandbox', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<p>safe body</p><script>window.__pwned = 1</script>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    expect(frame.getAttribute('srcdoc')).toContain('<script>window.__pwned = 1</script>')
    // Scripts run, but only inside an opaque origin walled off from the parent.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
  })

  it('neutralizes interactive payload markup inside srcdoc instead of inlining it into the host DOM', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse(
        '<p>ok</p><form><input value="x"><button>go</button><textarea></textarea></form><div contenteditable="true">edit me</div>'
      )
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    expect(frame.getAttribute('srcdoc')).toContain('<form>')
    expect(frame.getAttribute('srcdoc')).toContain('<input value="x" disabled="">')
    expect(frame.getAttribute('srcdoc')).toContain('<button disabled="">go</button>')
    expect(frame.getAttribute('srcdoc')).toContain('<textarea disabled="">')
    expect(frame.getAttribute('srcdoc')).toContain('contenteditable="false"')
    expect(frame.getAttribute('srcdoc')).not.toContain('contenteditable="true"')
    expect(frame.getAttribute('srcdoc')).toContain('ok')
    expect(frame.getAttribute('srcdoc')).toContain('edit me')
    expect(screen.getByTestId('html-doc-main').querySelector('form')).toBeNull()
  })

  it('absolutizes asset URLs before assigning iframe srcdoc', async () => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<img src="/d/slug/assets/a.png?sig=s1&exp=9"><a href="note.html">note</a>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="slug" />)
    const frame = await waitForFrame(container)
    expect(frame.getAttribute('srcdoc')).toContain('https://od.test/d/slug/assets/a.png?sig=s1&amp;exp=9')
    expect(frame.getAttribute('srcdoc')).toContain('href="note.html"')
  })

  it('lets the iframe own document scrolling instead of assigning measured inline height', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<main style="height:3000px">long body</main>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)
    expect(frame.style.height).toBe('')
  })

  it('SANITIZES when sanitizeDocHtml is used by legacy callers (strips a <script> from the payload)', () => {
    const out = sanitizeDocHtml('<p>safe body</p><script>window.__pwned = 1</script>')
    expect(String(out)).not.toContain('<script')
  })

  it('surfaces the attempted octo-doc URL in the error state (misconfig diagnostic)', async () => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
    stubFetch(() => htmlResponse('nope', false, 404))
    render(<HtmlDocView docId="dX" space="sp" />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByText('https://od.test/d/dX/v/latest')).toBeTruthy()
  })

  it('lays out the iframe content and comment panel in the ready body rail', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<p>body</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)

    const main = screen.getByTestId('html-doc-main')
    expect(main.querySelector('.octo-html-doc-frame')).toBeTruthy()
    expect(main.querySelector('[data-testid="html-doc-comment-panel"]')).toBeTruthy()
    expect(container.querySelector('.octo-html-doc-header')).toBeTruthy()
  })

  it('shows an element-anchored comment quote after the iframe document loads', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) {
        return jsonResponse({
          data: [
            {
              id: 'c1',
              text: 'check this paragraph',
              anchor: {
                kind: 'element',
                aid: 'a4',
                selector: '[data-odoc-aid="a4"]',
                label: 'p',
              },
              replies: [],
            },
          ],
        })
      }
      return htmlResponse('<p data-odoc-aid="a4">quoted paragraph from iframe</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)

    // The parent can't read the cross-origin frame; it asks the bridge for the element's text.
    // Install the auto-answering bridge stub BEFORE the frame loads so the very first resolve
    // request (fired when the comment panel first renders the element anchor) is answered.
    autoAnswerAnchorText(frame, { a4: 'quoted paragraph from iframe' })
    fireEvent.load(frame)

    await waitFor(() => expect(screen.getByTestId('comment-quote').textContent).toBe('quoted paragraph from iframe'))
  })

  it('keeps a selected anchor locked when selection collapses after focusing the comment input', async () => {
    // commenter+ so the composer + selection watcher are active (reader is read-only, no anchor).
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<p data-odoc-aid="a1">selected words</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)

    bridgeSelection(frame, { kind: 'element', aid: 'a1', selector: '[data-odoc-aid="a1"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a1'))

    const input = screen.getByPlaceholderText('docs.comment.placeholder')
    fireEvent.focus(input)
    // Collapsing the selection makes the bridge report null; the locked anchor must survive it.
    bridgeSelection(frame, null)

    expect(screen.getByTestId('pending-anchor').textContent).toContain('#a1')
  })

  it('binds selection before async role resolution and uses the latest permission without reloading the iframe', async () => {
    let resolveDoc!: (value: { data: unknown; status: number }) => void
    const docResult = new Promise<{ data: unknown; status: number }>((resolve) => { resolveDoc = resolve })
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1' ? docResult : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => url.includes('/comments') ? jsonResponse({ data: [] }) : htmlResponse('<p data-odoc-aid="late">late role</p>'))

    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)
    const lateAnchor: BridgeAnchor = { kind: 'element', aid: 'late', selector: '[data-odoc-aid="late"]', label: 'p' }

    // Before role resolves, mayComment is false so the bridge selection is ignored.
    bridgeSelection(frame, lateAnchor)
    expect(screen.queryByTestId('pending-anchor')).toBeNull()

    resolveDoc({ data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 })
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())
    // Same frame, no reload; the live permission now lets the next selection through.
    bridgeSelection(frame, lateAnchor)
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#late'))
    expect(container.querySelector('iframe.octo-html-doc-frame')).toBe(frame)
  })

  it('gates one bridge selection channel across permission and mode transitions', async () => {
    let currentRole: 'commenter' | 'reader' = 'commenter'
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: currentRole }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => url.includes('/comments') ? jsonResponse({ data: [] }) : htmlResponse('<p data-odoc-aid="a1">one</p>'))

    const { container, rerender } = render(<HtmlDocView docId="d1" space="sp1" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())
    const a1: BridgeAnchor = { kind: 'element', aid: 'a1', selector: '[data-odoc-aid="a1"]', label: 'p' }
    const a2: BridgeAnchor = { kind: 'element', aid: 'a2', selector: '[data-odoc-aid="a2"]', label: 'p' }

    // Demote to reader: the same window listener stays, but its mayComment gate now drops selections.
    currentRole = 'reader'
    rerender(<HtmlDocView docId="d1" space="sp2" />)
    await waitFor(() => expect(screen.queryByPlaceholderText('docs.comment.placeholder')).toBeNull())
    bridgeSelection(frame, a1)
    expect(screen.queryByTestId('pending-anchor')).toBeNull()

    // Re-promote to commenter without reloading the iframe; the live gate lets selections through.
    currentRole = 'commenter'
    rerender(<HtmlDocView docId="d1" space="sp3" />)
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())
    expect(container.querySelector('iframe.octo-html-doc-frame')).toBe(frame)
    bridgeSelection(frame, a2)
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a2'))

    // Code mode drops the anchor; back to page reloads the frame and selection resumes.
    fireEvent.click(screen.getByRole('tab', { name: 'docs.mode.code' }))
    expect(screen.queryByTestId('pending-anchor')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'docs.mode.page' }))
    const nextFrame = await waitForFrame(container)
    fireEvent.load(nextFrame)
    bridgeSelection(nextFrame, { kind: 'element', aid: 'a3', selector: '[data-odoc-aid="a3"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a3'))
  })

  it('clears the locked anchor only through the explicit target cancel action', async () => {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<p data-odoc-aid="a2">clearable words</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)

    bridgeSelection(frame, { kind: 'element', aid: 'a2', selector: '[data-odoc-aid="a2"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a2'))

    fireEvent.click(screen.getByText('docs.comment.clearAnchor'))

    expect(screen.getByTestId('pending-anchor').textContent).toContain('docs.comment.targetDoc')
    expect(screen.getByTestId('pending-anchor').textContent).not.toContain('#a2')
  })

  it('freezes the pending anchor once the composer is engaged (focus): a hostile doc cannot swap it', async () => {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) =>
      url.includes('/comments')
        ? jsonResponse({ data: [] })
        : htmlResponse('<p data-odoc-aid="good">reviewed target</p><p data-odoc-aid="evil">swapped target</p>'),
    )
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)

    // Human selects the target they intend to comment on.
    bridgeSelection(frame, { kind: 'element', aid: 'good', selector: '[data-odoc-aid="good"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#good'))

    // Human engages the composer (focus). From here the anchor is FROZEN.
    fireEvent.focus(screen.getByPlaceholderText('docs.comment.placeholder'))
    // Hostile document fires a selection message trying to swap the reviewed target.
    bridgeSelection(frame, { kind: 'element', aid: 'evil', selector: '[data-odoc-aid="evil"]', label: 'p' })

    // Give the coalesce timer room to flush; the swap must be ignored (still #good, never #evil).
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.getByTestId('pending-anchor').textContent).toContain('#good')
    expect(screen.getByTestId('pending-anchor').textContent).not.toContain('#evil')
  })

  it('freezes the pending anchor while a non-empty draft is held (even without focus)', async () => {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) =>
      url.includes('/comments')
        ? jsonResponse({ data: [] })
        : htmlResponse('<p data-odoc-aid="good">reviewed</p><p data-odoc-aid="evil">swap</p>'),
    )
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)

    bridgeSelection(frame, { kind: 'element', aid: 'good', selector: '[data-odoc-aid="good"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#good'))

    const input = screen.getByPlaceholderText('docs.comment.placeholder')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'my review note' } })
    fireEvent.blur(input) // blur, but the non-empty draft keeps the composer engaged

    bridgeSelection(frame, { kind: 'element', aid: 'evil', selector: '[data-odoc-aid="evil"]', label: 'p' })
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.getByTestId('pending-anchor').textContent).toContain('#good')
    expect(screen.getByTestId('pending-anchor').textContent).not.toContain('#evil')
  })

  it('accepts a fresh selection again after the human explicitly clears (disengaging the composer)', async () => {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) =>
      url.includes('/comments')
        ? jsonResponse({ data: [] })
        : htmlResponse('<p data-odoc-aid="good">a</p><p data-odoc-aid="next">b</p>'),
    )
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)

    bridgeSelection(frame, { kind: 'element', aid: 'good', selector: '[data-odoc-aid="good"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#good'))

    // Engage (focus, no draft), then explicitly clear: an empty draft + blur means the composer is
    // no longer engaged, so a new legitimate selection is honored again.
    fireEvent.focus(screen.getByPlaceholderText('docs.comment.placeholder'))
    fireEvent.click(screen.getByText('docs.comment.clearAnchor'))
    fireEvent.blur(screen.getByPlaceholderText('docs.comment.placeholder'))

    bridgeSelection(frame, { kind: 'element', aid: 'next', selector: '[data-odoc-aid="next"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#next'))
  })

  it('coalesces a burst of selection messages into a single adopted anchor (the latest wins)', async () => {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) =>
      url.includes('/comments')
        ? jsonResponse({ data: [] })
        : htmlResponse('<p data-odoc-aid="a1">1</p><p data-odoc-aid="a2">2</p><p data-odoc-aid="a3">3</p>'),
    )
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())

    // Fire three selection messages synchronously (a drag-select burst) inside one coalesce window.
    bridgeSelection(frame, { kind: 'element', aid: 'a1', selector: '[data-odoc-aid="a1"]', label: 'p' })
    bridgeSelection(frame, { kind: 'element', aid: 'a2', selector: '[data-odoc-aid="a2"]', label: 'p' })
    bridgeSelection(frame, { kind: 'element', aid: 'a3', selector: '[data-odoc-aid="a3"]', label: 'p' })

    // Only the LAST anchor is adopted after the single trailing flush.
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a3'))
    expect(screen.getByTestId('pending-anchor').textContent).not.toContain('#a1')
    expect(screen.getByTestId('pending-anchor').textContent).not.toContain('#a2')
  })

  it('safely resolves element anchors whose aid is an Object.prototype key name (Map cache, no proto hit)', async () => {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    // All three prototype-poisoning names plus Object.prototype member names must round-trip: the
    // Map cache uses own-key semantics, so none is a prototype-chain hit and each resolves/renders.
    const aids = ['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']
    stubFetch((url) => {
      if (url.includes('/comments')) {
        return jsonResponse({
          data: aids.map((aid, i) => ({
            id: `c${i}`,
            text: `note ${aid}`,
            anchor: { kind: 'element', aid, selector: `[data-odoc-aid="${aid}"]`, label: 'p' },
            replies: [],
          })),
        })
      }
      return htmlResponse(aids.map((aid) => `<p data-odoc-aid="${aid}">text-${aid}</p>`).join(''))
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    autoAnswerAnchorText(frame, Object.fromEntries(aids.map((aid) => [aid, `text-${aid}`])))
    fireEvent.load(frame)

    // Every thread renders (no crash) and each resolves its own distinct quote from the Map cache.
    await waitFor(() => expect(screen.getAllByTestId('comment-quote')).toHaveLength(aids.length))
    const quotes = screen.getAllByTestId('comment-quote').map((n) => n.textContent)
    for (const aid of aids) expect(quotes).toContain(`text-${aid}`)
  })

  it('ignores bridge messages whose source is not the iframe (forged origin / other window)', async () => {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<p data-odoc-aid="a9">words</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())

    // A perfectly-shaped selection message but from a source that is NOT the frame's contentWindow
    // (e.g. window itself, an extension, or another frame) must be dropped by the identity check.
    const forged = new MessageEvent('message', {
      data: { channel: BRIDGE_CHANNEL, type: 'selection', anchor: { kind: 'element', aid: 'a9', selector: '[data-odoc-aid="a9"]', label: 'p' } },
    })
    Object.defineProperty(forged, 'source', { value: window, configurable: true })
    window.dispatchEvent(forged)

    // The forged message was dropped: the composer target stays doc-level (no #a9 adopted).
    expect(screen.getByTestId('pending-anchor').textContent).not.toContain('#a9')

    // The same message from the real frame IS honored, proving the gate is source identity, not shape.
    bridgeSelection(frame, { kind: 'element', aid: 'a9', selector: '[data-odoc-aid="a9"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a9'))
  })

  it('uses the rendered numeric version when posting from the latest route with an element anchor', async () => {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    const spy = stubFetch((url, init) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ id: 'new1' })
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse(
        '<script>window.__ODOC__ = {"version":4};</script><p data-odoc-aid="a3">post anchored words</p>'
      )
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="slug-1" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)

    bridgeSelection(frame, { kind: 'element', aid: 'a3', selector: '[data-odoc-aid="a3"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a3'))

    const input = screen.getByPlaceholderText('docs.comment.placeholder')
    fireEvent.focus(input)
    // Collapse is reported as a null selection; the locked anchor must persist through posting.
    bridgeSelection(frame, null)
    fireEvent.change(input, { target: { value: 'anchored note' } })
    fireEvent.click(screen.getByText('docs.comment.send'))

    await waitFor(() => {
      const post = spy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST')
      expect(post).toBeTruthy()
    })
    const post = spy.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'POST') as unknown as [
      string,
      RequestInit
    ]
    const body = JSON.parse(String(post[1].body))
    expect(
      spy.mock.calls.some(([url, init]) =>
        (init?.method ?? 'GET') === 'GET' && String(url).includes('/v1/comments?slug=slug-1&version=latest')
      )
    ).toBe(true)
    expect(body.version).toBe(4)
    expect(body.anchor).toMatchObject({ kind: 'element', aid: 'a3' })
  })

  // --- issue #27 iteration-2 reviewer findings: deterministic bridge behaviour ---

  it('resolves an element-anchor quote via the post-commit bridge queue (render stays pure)', async () => {
    // resolveAnchorText must not postMessage during render; the request is flushed after commit.
    // We assert the request is only observed AFTER render settles, and the reply fills the quote.
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => {
      if (url.includes('/comments')) {
        return jsonResponse({
          data: [
            {
              id: 'c1', text: 'note', author: { uid: 'u_owner' }, created_at: 1,
              anchor: { kind: 'element', aid: 'aq', selector: '[data-odoc-aid="aq"]', label: 'p' },
              replies: [],
            },
          ],
        })
      }
      return htmlResponse('<p data-odoc-aid="aq">resolved quote text</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    let sawRequest = false
    const win = frame.contentWindow as Window
    const orig = win.postMessage.bind(win)
    win.postMessage = ((msg: unknown) => {
      const m = msg as { channel?: string; type?: string; nonce?: string; token?: string }
      if (m?.channel === BRIDGE_CHANNEL && m.type === 'resolve-anchor-text') {
        sawRequest = true
        // Answer as the frame would, echoing the token.
        postBridge(frame, { type: 'anchor-text', token: m.token, nonce: m.nonce, text: 'resolved quote text' })
      }
    }) as typeof win.postMessage
    fireEvent.load(frame)
    await waitFor(() => expect(screen.getByTestId('comment-quote').textContent).toBe('resolved quote text'))
    expect(sawRequest).toBe(true)
    win.postMessage = orig
  })

  it('resolves anchor text under StrictMode with no render-phase update warning (render stays pure)', async () => {
    // Regression for finding #1: resolveAnchorText must be a pure cache read — no ref writes and no
    // queueMicrotask/setState during render. Under StrictMode (double-invoked render) any such
    // side effect surfaces as a React "Cannot update a component while rendering" console.error.
    // We capture console.error and assert the anchor path emits none while the quote still resolves.
    const errors: string[] = []
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '))
    })
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => {
      if (url.includes('/comments')) {
        return jsonResponse({
          data: [
            {
              id: 'c1', text: 'note', author: { uid: 'u_owner' }, created_at: 1,
              anchor: { kind: 'element', aid: 'asm', selector: '[data-odoc-aid="asm"]', label: 'p' },
              replies: [],
            },
          ],
        })
      }
      return htmlResponse('<p data-odoc-aid="asm">strict quote</p>')
    })
    const { container } = render(
      <StrictMode>
        <HtmlDocView docId="d1" space="sp" />
      </StrictMode>,
    )
    const frame = await waitForFrame(container)
    autoAnswerAnchorText(frame, { asm: 'strict quote' })
    fireEvent.load(frame)
    await waitFor(() => expect(screen.getByTestId('comment-quote').textContent).toBe('strict quote'))
    // No render-phase state-update warning attributable to anchor resolution.
    const bad = errors.filter(
      (e) => /Cannot update a component .* while rendering/i.test(e) || /Warning: Cannot update/i.test(e),
    )
    expect(bad).toEqual([])
    errSpy.mockRestore()
  })

  it('rejects a stale/replayed anchor-text reply (unknown nonce) and a wrong-token reply', async () => {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => {
      if (url.includes('/comments')) {
        return jsonResponse({
          data: [
            {
              id: 'c1', text: 'note', author: { uid: 'u_owner' }, created_at: 1,
              anchor: { kind: 'element', aid: 'as', selector: '[data-odoc-aid="as"]', label: 'p' },
              replies: [],
            },
          ],
        })
      }
      return htmlResponse('<p data-odoc-aid="as">real text</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)
    // A forged reply with a nonce we never issued must be ignored (no injected quote).
    postBridge(frame, { type: 'anchor-text', nonce: 'never-issued', text: 'FORGED' })
    // A reply with a wrong token is also ignored.
    postBridge(frame, { type: 'anchor-text', token: 'wrong-token', nonce: 'never-issued', text: 'FORGED2' })
    // Give effects a tick; the quote must NOT be the forged text.
    await waitFor(() => expect(screen.getByTestId('html-doc-comment')).toBeTruthy())
    expect(screen.queryByText('FORGED')).toBeNull()
    expect(screen.queryByText('FORGED2')).toBeNull()
  })

  it('rejects a replayed gen-A token+nonce against gen B (two real srcDoc generations)', async () => {
    // Build TWO actual generations with distinct tokens: gen A at v1, gen B at v2 (each a fresh
    // fetch → fresh srcDoc → fresh newBridgeToken). Issue a resolve nonce in gen A, switch to gen B,
    // then replay gen A's (token, nonce) from the SAME contentWindow — it must be rejected (stale
    // token). A gen-A nonce replayed under gen B's token is also rejected (unissued nonce).
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => {
      if (url.includes('/comments')) {
        return jsonResponse({
          data: [
            {
              id: 'c1', text: 'note', author: { uid: 'u_owner' }, created_at: 1,
              anchor: { kind: 'element', aid: 'ar', selector: '[data-odoc-aid="ar"]', label: 'p' },
              replies: [],
            },
          ],
        })
      }
      return htmlResponse('<p data-odoc-aid="ar">gen text</p>')
    })

    // Capture the (token, nonce) of every resolve request the parent issues, per generation.
    const issued: Array<{ token?: string; nonce?: string }> = []
    function tapFrame(f: HTMLIFrameElement) {
      const win = f.contentWindow as Window
      const orig = win.postMessage.bind(win)
      win.postMessage = ((msg: unknown) => {
        const m = msg as { channel?: string; type?: string; token?: string; nonce?: string }
        if (m?.channel === BRIDGE_CHANNEL && m.type === 'resolve-anchor-text') {
          issued.push({ token: m.token, nonce: m.nonce })
        }
      }) as typeof win.postMessage
      return orig
    }

    // --- Generation A (v1) ---
    const { container, rerender } = render(<HtmlDocView docId="d1" space="sp" version="1" />)
    const frameA = await waitForFrame(container)
    const tokenA = frameToken(frameA)
    tapFrame(frameA)
    fireEvent.load(frameA)
    // The post-commit resolve effect issues a request for the visible element anchor under gen A.
    await waitFor(() => expect(issued.some((r) => r.token === tokenA && r.nonce)).toBe(true))
    const nonceA = issued.find((r) => r.token === tokenA)?.nonce as string

    // --- Generation B (v2): a fresh fetch rebuilds srcDoc with a NEW token ---
    rerender(<HtmlDocView docId="d1" space="sp" version="2" />)
    const frameB = await waitFor(() => {
      const f = container.querySelector('iframe.octo-html-doc-frame') as HTMLIFrameElement
      const tk = frameToken(f)
      if (!tk || tk === tokenA) throw new Error('gen B token not ready')
      return f
    })
    const tokenB = frameToken(frameB)
    expect(tokenB).not.toBe(tokenA)
    tapFrame(frameB)
    fireEvent.load(frameB)

    // Replay gen A's token+nonce from the current frame: dropped by the stale-token gate.
    postBridge(frameB, { type: 'anchor-text', token: tokenA, nonce: nonceA, text: 'REPLAY_A' })
    // Gen A's nonce under gen B's (current) token: dropped by the unissued-nonce gate.
    postBridge(frameB, { type: 'anchor-text', token: tokenB, nonce: nonceA, text: 'REPLAY_A_B' })
    await waitFor(() => expect(screen.getByTestId('html-doc-comment')).toBeTruthy())
    expect(screen.queryByText('REPLAY_A')).toBeNull()
    expect(screen.queryByText('REPLAY_A_B')).toBeNull()

    // A legitimate gen-B reply (current token + a gen-B-issued nonce) IS accepted.
    await waitFor(() => expect(issued.some((r) => r.token === tokenB && r.nonce)).toBe(true))
    const nonceB = issued.find((r) => r.token === tokenB)?.nonce as string
    postBridge(frameB, { type: 'anchor-text', token: tokenB, nonce: nonceB, text: 'gen text' })
    await waitFor(() => expect(screen.getByTestId('comment-quote').textContent).toBe('gen text'))
  })

  it('safely handles a hostile data-odoc-aid selection anchor (no selector break-out)', async () => {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => (url.includes('/comments') ? jsonResponse({ data: [] }) : htmlResponse('<p>x</p>')))
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)
    // A selection anchor whose aid carries selector metacharacters is accepted as a bounded string
    // (worst case: a bogus comment target). It must NOT throw and must surface as the target.
    const hostile = '"] , [data-x="'
    bridgeSelection(frame, { kind: 'element', aid: hostile, selector: `[data-odoc-aid="${hostile}"]`, label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain(`#${hostile}`))
  })

  it('activates a thread anchor: clicking the quote posts a scroll-to-anchor to the frame', async () => {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => {
      if (url.includes('/comments')) {
        return jsonResponse({
          data: [
            {
              id: 'c1', text: 'note', author: { uid: 'u_owner' }, created_at: 1,
              anchor: { kind: 'element', aid: 'ah', selector: '[data-odoc-aid="ah"]', label: 'p' },
              replies: [],
            },
          ],
        })
      }
      return htmlResponse('<p data-odoc-aid="ah">scroll target</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    const sent: Array<{ type?: string; aid?: string; token?: string }> = []
    const win = frame.contentWindow as Window
    const orig = win.postMessage.bind(win)
    win.postMessage = ((msg: unknown) => {
      const m = msg as { channel?: string; type?: string; aid?: string; token?: string; nonce?: string }
      if (m?.channel === BRIDGE_CHANNEL) {
        sent.push({ type: m.type, aid: m.aid, token: m.token })
        if (m.type === 'resolve-anchor-text') postBridge(frame, { type: 'anchor-text', token: m.token, nonce: m.nonce, text: 'scroll target' })
      }
    }) as typeof win.postMessage
    fireEvent.load(frame)
    const quote = await screen.findByTestId('comment-quote')
    fireEvent.click(quote)
    await waitFor(() => expect(sent.some((m) => m.type === 'scroll-to-anchor' && m.aid === 'ah')).toBe(true))
    // The scroll request carries the current render token.
    const scroll = sent.find((m) => m.type === 'scroll-to-anchor')
    expect(scroll?.token).toBe(frameToken(frame))
    win.postMessage = orig
  })
})

describe('sanitizeDocHtml', () => {
  it('strips <script>, on* handlers and javascript: URLs (XSS baseline)', () => {
    const out = sanitizeDocHtml(
      '<p>hi</p>' +
        '<script>alert(1)</script>' +
        '<img src="x" onerror="alert(2)">' +
        '<a href="javascript:alert(3)">bad link</a>' +
        '<div onclick="alert(4)">clicky</div>'
    )
    expect(out).not.toContain('<script')
    expect(out.toLowerCase()).not.toContain('onerror')
    expect(out.toLowerCase()).not.toContain('onclick')
    expect(out.toLowerCase()).not.toContain('javascript:')
    // The benign wrapper text survives.
    expect(out).toContain('hi')
  })

  it('removes interactive/editable elements and contenteditable (read-only hard rule)', () => {
    const out = sanitizeDocHtml(
      '<p>keep</p>' +
        '<input value="x">' +
        '<button>go</button>' +
        '<textarea>t</textarea>' +
        '<form><select><option>o</option></select></form>' +
        '<div contenteditable="true">editable</div>'
    )
    for (const tag of ['<input', '<button', '<textarea', '<form', '<select', '<option']) {
      expect(out.toLowerCase()).not.toContain(tag)
    }
    expect(out.toLowerCase()).not.toContain('contenteditable')
    expect(out).toContain('keep')
  })

  it('strips inline style entirely (CSS injection surface: url(javascript:)/expression()/exfil url)', () => {
    // DOMPurify keeps inline style verbatim without deep-cleaning CSS values, so the whole
    // attribute is forbidden (method A). The javascript: CSS payload must not survive.
    const out = sanitizeDocHtml('<div style="background:url(javascript:alert(1))">x</div>')
    expect(out.toLowerCase()).not.toContain('javascript:')
    expect(out.toLowerCase()).not.toContain('style=')
    expect(out).toContain('x')
  })

  it('drops even a benign inline style (method A forbids the style attribute wholesale)', () => {
    const out = sanitizeDocHtml('<div style="width:100px">x</div>')
    expect(out.toLowerCase()).not.toContain('style=')
    // The element + text content itself survive; only the style attribute is stripped.
    expect(out).toContain('x')
  })

  it('preserves ordinary display markup (headings/paragraph/table/safe links)', () => {
    const out = sanitizeDocHtml(
      '<h1>Report</h1><p>Body</p><table><tr><td>cell</td></tr></table><a href="https://ok.test">link</a>'
    )
    expect(out).toContain('<h1>')
    expect(out).toContain('<p>')
    expect(out).toContain('<table>')
    expect(out).toContain('href="https://ok.test"')
  })
})

describe('injectBaseHref (parser-aware)', () => {
  it('inserts <base> as the FIRST child of an existing <head> with a trailing-slash href', () => {
    const out = injectBaseHref('<html><head><title>t</title></head><body>x</body></html>', 'https://od.test')
    expect(out).toContain('<base href="https://od.test/">')
    // Only one base, and it precedes the original head content.
    expect(out.split('<base').length - 1).toBe(1)
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<title>'))
  })

  it('preserves an already-trailing slash and synthesizes a <head> when the doc has only a body', () => {
    const out = injectBaseHref('<p>no head</p>', 'https://od.test/')
    expect(out).toContain('<base href="https://od.test/">')
    // DOMParser normalizes the fragment: base lands in the synthesized <head>, before <body>.
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<body'))
    expect(out).toContain('<p>no head</p>')
  })

  it('is a no-op when baseUrl is empty', () => {
    expect(injectBaseHref('<p>x</p>', '')).toBe('<p>x</p>')
  })

  it('does NOT mis-target a FAKE <head> inside an HTML comment (only the real head gets <base>)', () => {
    const out = injectBaseHref(
      '<html><head><title>t</title></head><body><!-- <head>fake</head> --></body></html>',
      'https://od.test',
    )
    expect(out.split('<base').length - 1).toBe(1)
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<title>'))
  })

  it('does NOT mis-target a fake <head> living in an attribute value', () => {
    const out = injectBaseHref(
      '<html><head></head><body><div data-x="<head>">z</div></body></html>',
      'https://od.test',
    )
    expect(out.split('<base').length - 1).toBe(1)
    // The <base> sits in the real head, not inside the div attribute.
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<body'))
  })

  it('does NOT mis-target a fake <head> inside <script>/<style> raw-text', () => {
    const script = injectBaseHref(
      '<html><head><script>var s="<head>";<\/script></head><body>y</body></html>',
      'https://od.test',
    )
    expect(script.split('<base').length - 1).toBe(1)
    const style = injectBaseHref(
      '<html><head><style>/* <head> */</style></head><body>y</body></html>',
      'https://od.test',
    )
    expect(style.split('<base').length - 1).toBe(1)
  })

  it('does NOT treat a <head> inside a <template> as the document head', () => {
    const out = injectBaseHref(
      '<html><head><title>t</title></head><body><template><head>nope</head></template></body></html>',
      'https://od.test',
    )
    expect(out.split('<base').length - 1).toBe(1)
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<title>'))
  })

  it('fails closed without DOMParser (SSR): returns the HTML unchanged, never regex-injects', () => {
    const raw = '<html><head><title>t</title></head><body>x</body></html>'
    const saved = globalThis.DOMParser
    delete (globalThis as { DOMParser?: unknown }).DOMParser
    try {
      expect(injectBaseHref(raw, 'https://od.test')).toBe(raw)
    } finally {
      ;(globalThis as { DOMParser?: unknown }).DOMParser = saved
    }
  })
})

describe('HtmlDocView — header parity (presence / comments / members / more)', () => {
  let wk: ReturnType<typeof createMockWKApp>

  function serveDoc(htmlBody: string, meta?: Record<string, unknown>, opts?: { isAuthor?: boolean }) {
    const inline = meta ? `<script>window.__ODOC__ = ${JSON.stringify(meta)};</script>` : ''
    // Authorship is backend-decided and inlined as __ODOC_CAP__ = {isAuthor: true} — a JS object
    // literal with an UNQUOTED key (NOT JSON), matching the Go injectCapMarker output exactly so
    // the parser is tested against the real wire format.
    const cap =
      opts?.isAuthor === undefined
        ? ''
        : `<script>window.__ODOC_CAP__ = {isAuthor: ${opts.isAuthor ? 'true' : 'false'}};</script>`
    return stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse(`${cap}${inline}${htmlBody}`)
    })
  }

  beforeEach(() => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
    wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    setWKApp(wk)
  })
  afterEach(() => {
    delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
    // Reset the WKApp override so it never leaks into other suites in this file.
    setWKApp(undefined as never)
  })

  it('renders exactly one viewer avatar using the current viewer name initial', async () => {
    wk.spaceMembers.push({ uid: 'u_viewer', name: '王留超' })
    serveDoc('<p>body</p>')
    const { container } = render(<HtmlDocView docId="d1" space="sp_viewer_name" />)
    await waitForFrame(container)
    const presence = screen.getByTestId('html-doc-presence')
    expect(presence.querySelectorAll('.octo-avatar')).toHaveLength(1)
    await waitFor(() => expect(presence.querySelector('.octo-avatar')?.textContent).toBe('王'))
    expect(presence.querySelector('.octo-avatar')?.getAttribute('title')).toBe('王留超')
    expect(container.textContent).not.toContain('Synced')
    expect(container.textContent).not.toContain('Connecting')
  })

  it('toggles the comment panel with the 💬 comments button (open by default)', async () => {
    serveDoc('<p>body</p>')
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    expect(screen.getByTestId('html-doc-comment-panel')).toBeTruthy()
    fireEvent.click(screen.getByTitle('docs.toolbar.comments'))
    expect(screen.queryByTestId('html-doc-comment-panel')).toBeNull()
    fireEvent.click(screen.getByTitle('docs.toolbar.comments'))
    expect(screen.getByTestId('html-doc-comment-panel')).toBeTruthy()
  })

  it('lists comments for the in-page history version while mutating the rendered version', async () => {
    // commenter+ so the composer renders (four-role redesign: reader is read-only).
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    const spy = stubFetch((url, init) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ id: 'new1' })
      if (url.endsWith('/v1/docs/slug-1/versions')) {
        return jsonResponse({ data: { versions: [{ n: 4 }, { n: 3 }] } })
      }
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      const renderedVersion = url.endsWith('/v/3') ? 3 : 4
      return htmlResponse(`<script>window.__ODOC__ = {"version":${renderedVersion}};</script><p>body</p>`)
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="slug-1" />)
    await waitForFrame(container)

    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    fireEvent.click(screen.getByText('docs.toolbar.history'))
    await waitFor(() => expect(screen.getAllByText('docs.version.view')).toHaveLength(2))
    fireEvent.click(screen.getAllByText('docs.version.view')[1])

    await waitFor(() => {
      expect(
        spy.mock.calls.some(([url, init]) =>
          (init?.method ?? 'GET') === 'GET' && String(url).includes('/v1/comments?slug=slug-1&version=3')
        )
      ).toBe(true)
    })

    fireEvent.change(screen.getByPlaceholderText('docs.comment.placeholder'), { target: { value: 'version note' } })
    fireEvent.click(screen.getByText('docs.comment.send'))

    await waitFor(() => expect(spy.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST') as unknown as [string, RequestInit]
    expect(JSON.parse(String(post[1].body)).version).toBe(3)
  })

  it('hides the member button entirely for a non-author viewer', async () => {
    // Members are author-only: __ODOC_CAP__.isAuthor=false → the button is not rendered at all
    // (not merely a click-to-empty no-op). __ODOC__.identity is the viewer, never proof of authorship.
    serveDoc('<p>body</p>', { creator_uid: 'u_other' }, { isAuthor: false })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    expect(screen.queryByTitle('docs.toolbar.members')).toBeNull()
    expect(container.querySelector('.octo-member-panel')).toBeNull()
    expect(container.querySelector('.octo-modal-overlay')).toBeNull()
  })

  it('hides the member button when the author marker is absent (fail closed)', async () => {
    // Legacy/streamed doc with no __ODOC_CAP__ → treated as non-author (the invited-viewer bug:
    // previously a missing creator_uid made every viewer an author).
    serveDoc('<p>body</p>', { creator_uid: 'u_other' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    expect(screen.queryByTitle('docs.toolbar.members')).toBeNull()
    expect(container.querySelector('.octo-member-panel')).toBeNull()
  })

  it('opens the member panel in a centered modal when the viewer IS the author', async () => {
    // Backend-authoritative author flag drives the gate; the button opens the shared modal shell
    // (.octo-modal-overlay > .octo-modal), matching the rich-doc member modal (EditorShell #A4).
    serveDoc('<p>body</p>', { creator_uid: 'u_owner' }, { isAuthor: true })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    fireEvent.click(screen.getByTitle('docs.toolbar.members'))
    expect(container.querySelector('.octo-modal-overlay .octo-modal')).toBeTruthy()
    expect(container.querySelector('.octo-member-panel')).toBeTruthy()
    // Clicking the overlay backdrop closes the modal (parity with EditorShell #A4).
    fireEvent.mouseDown(container.querySelector('.octo-modal-overlay') as HTMLElement)
    expect(container.querySelector('.octo-modal-overlay')).toBeNull()
  })

  it('shows the pending access-request count on the HTML Members button', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d1') {
        return { data: { docId: 'd1', ownerId: 'u_owner', role: 'admin' }, status: 200 }
      }
      if (method === 'get' && url === '/docs/d1/access-requests?status=pending') {
        return { data: { items: [{ requestId: 'r1', uid: 'u1' }, { requestId: 'r2', uid: 'u2' }] }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    serveDoc('<p>body</p>', { creator_uid: 'u_owner' }, { isAuthor: true })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)

    const membersButton = screen.getByTitle('docs.toolbar.members')
    await waitFor(() => expect(membersButton.querySelector('.octo-access-badge')?.textContent).toBe('2'))
  })

  it('admin-not-author viewer never sees author-only slots and never lists octo-doc grants (OCT-216 regression)', async () => {
    // Two gates, two authorities: octo-doc author manages /v1/docs/{slug}/grants (Slot 2/5);
    // docs-backend admin manages Share/Invite/Requests (Slot 1/3/4). Merging them at the parent
    // would leak author-only slots to a non-author admin AND drive a 403 on the author-only
    // listGrants endpoint. HtmlDocView must forward isAuthor + role WITHOUT collapsing them into
    // the legacy `canManage` prop.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d1') {
        return { data: { docId: 'd1', ownerId: 'u_owner', role: 'admin' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    const fetchSpy = serveDoc('<p>body</p>', { creator_uid: 'u_owner' }, { isAuthor: false })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="the-slug" />)
    await waitForFrame(container)
    // Wait for docs-backend role to land so the panel's backend gate can render its slots.
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d1')).toBe(true))
    // Admin still gets the entry (canOpenPanel = isAuthor OR admin) and the modal opens.
    fireEvent.click(screen.getByTitle('docs.toolbar.members'))
    await waitFor(() =>
      expect(container.querySelector('.octo-modal-overlay .octo-member-panel')).toBeTruthy()
    )
    // Backend slot 1 (ShareScope) heading is present so we know the panel finished rendering.
    await waitFor(() => expect(screen.queryByText('docs.share.title')).toBeTruthy())
    // Author-only slots must stay hidden — the leaked-merge bug rendered both of these.
    expect(screen.queryByText('docs.member.addMember')).toBeNull()
    expect(screen.queryByText('docs.member.currentMembers')).toBeNull()
    // And the author-only octo-doc grants endpoint must never be called (it would 403 and drive
    // the "docs.member.errorLoad" banner into the panel).
    const grantsCalls = (fetchSpy.mock.calls as unknown as Array<[unknown]>)
      .map((c) => String(c[0]))
      .filter((u) => u.includes('/v1/docs/') && u.includes('/grants'))
    expect(grantsCalls).toEqual([])
    expect(screen.queryByText('docs.member.errorLoad')).toBeNull()
  })

  it('forwards the whole-doc link via startDocForward from the header forward button (non-admin viewer: canGrant=false)', async () => {
    // docs-backend GET /docs/:id supplies the LIVE role + ownerId startDocForward consumes; a reader
    // whose uid ≠ owner produces canGrant=false, matching the prior sharing-only behaviour.
    wk.apiClient.responder = (method, url) => {
      // docs-backend is keyed by docId (d1), NEVER by the octo-doc slug (the-slug).
      if (method === 'get' && url === '/docs/d1') {
        return { data: { docId: 'd1', ownerId: 'u_owner', role: 'reader' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    serveDoc('<p>body</p>', { title: 'My Doc' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="the-slug" version="v2" />)
    await waitForFrame(container)
    // Wait for the role to land so the click is not early-returned by the `!role` guard.
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d1')).toBe(true))
    fireEvent.click(screen.getByTitle('docs.forward.entry'))
    await waitFor(() => expect(wk.openDocForwardCalls).toHaveLength(1))
    expect(wk.openDocForwardCalls[0]).toMatchObject({ docId: 'd1', title: 'My Doc', canGrant: false })
    expect(typeof wk.openDocForwardCalls[0].link).toBe('string')
    // Sharing-only: no grantAccess executor when canGrant is false.
    expect(wk.openDocForwardCalls[0].grantAccess).toBeUndefined()
  })

  it('opens forward with canGrant=true and wires a grantAccess executor when the viewer is owner/admin (computeCanGrant)', async () => {
    // Owner (uid === ownerId) satisfies computeCanGrant regardless of role; grantAccess must be
    // wired to the /docs/{docId}/forward-grant loop so the modal授权区 fires the per-uid grants.
    wk.apiClient.responder = (method, url) => {
      // docs-backend is keyed by docId (d1), NEVER by the octo-doc slug (the-slug).
      if (method === 'get' && url === '/docs/d1') {
        return { data: { docId: 'd1', ownerId: 'u_viewer', role: 'admin' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    serveDoc('<p>body</p>', { title: 'My Doc' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="the-slug" version="v2" />)
    await waitForFrame(container)
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d1')).toBe(true))
    fireEvent.click(screen.getByTitle('docs.forward.entry'))
    await waitFor(() => expect(wk.openDocForwardCalls).toHaveLength(1))
    expect(wk.openDocForwardCalls[0]).toMatchObject({ docId: 'd1', canGrant: true })
    expect(typeof wk.openDocForwardCalls[0].grantAccess).toBe('function')
  })

  it('does not render the Forward button while docs-backend role is still loading (no dead button, no stale canGrant snapshot)', async () => {
    // A never-resolving getDoc keeps role=null. Previously the button rendered and the handler
    // early-returned on `!role` — a silent dead button. The button gate now includes `role`, so
    // the affordance is hidden entirely; startDocForward stays unfired (mirrors EditorShell
    // `if (!role) return`) so a demoted admin never gets a stale canGrant snapshot.
    wk.apiClient.responder = () => new Promise(() => {})
    serveDoc('<p>body</p>', { title: 'My Doc' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="the-slug" version="v2" />)
    await waitForFrame(container)
    expect(screen.queryByTitle('docs.forward.entry')).toBeNull()
    expect(container.querySelector('.octo-doc-forward-btn')).toBeNull()
    expect(wk.openDocForwardCalls).toHaveLength(0)
  })

  it('does not render the Forward button while role is unresolved (mirrors EditorShell role && canForward gate, no dead button)', async () => {
    // role=null (getDoc 404 fail-soft) must hide the Forward button entirely, not render a silent
    // no-op affordance. Mirrors EditorShell.tsx `{role && canForward && (` gate.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d1') {
        return { data: {}, status: 404 }
      }
      return { data: {}, status: 200 }
    }
    serveDoc('<p>body</p>', { title: 'My Doc' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="the-slug" version="v2" />)
    await waitForFrame(container)
    // Let the 404 land so role definitively resolves to null (not merely still-loading).
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d1')).toBe(true))
    expect(screen.queryByTitle('docs.forward.entry')).toBeNull()
    expect(container.querySelector('.octo-doc-forward-btn')).toBeNull()
  })

  it('hides the More-menu Forward entry when role is unresolved (twin of the toolbar gate; no dead menu row)', async () => {
    // OCT-220 short-return: the toolbar Forward at :579 was gated on `role && canForward`, but its
    // twin inside DocMoreMenu at :614 still only checked `canForward`. On the role=null fail-soft
    // path (getDoc 404, or docs-backend rejects) the menu row rendered as a clickable no-op that
    // doForward's `if (!canForward || !role) return` guard silently swallowed. Both Forward
    // affordances must hide together — otherwise the twin entries diverge in behaviour.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d1') {
        return { data: {}, status: 404 }
      }
      return { data: {}, status: 200 }
    }
    serveDoc('<p>body</p>', { title: 'My Doc' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="the-slug" version="v2" />)
    await waitForFrame(container)
    // Let the 404 land so role is definitively null (not merely still-loading).
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d1')).toBe(true))
    // Open the ≡ menu so any conditional menu items render into the DOM.
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    // The neutral "open in new page" row is always present — confirms the menu did open, so a
    // missing Forward row means it was gated out, not that the menu itself failed to render.
    expect(screen.getByText('docs.standalone.openInNewPage')).toBeTruthy()
    // Forward must be absent from both surfaces: no toolbar button AND no menu row.
    expect(screen.queryByTitle('docs.forward.entry')).toBeNull()
    expect(container.querySelector('.octo-doc-forward-btn')).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /docs\.forward\.entry/ })).toBeNull()
  })

  it('renders BOTH Forward entries (toolbar + More menu) once role resolves — reader suffices, guarding against over-tightening', async () => {
    // Positive symmetric case: when role is resolved AND canForward is true, both twin Forward
    // affordances must render together. Prevents the fix from over-collapsing the gate and hiding
    // the menu row in the very case where the toolbar button is showing.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d1') {
        return { data: { docId: 'd1', ownerId: 'u_owner', role: 'reader' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    serveDoc('<p>body</p>', { title: 'My Doc' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="the-slug" version="v2" />)
    await waitForFrame(container)
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d1')).toBe(true))
    // Toolbar Forward first — waits out role resolution.
    await waitFor(() => expect(screen.queryByTitle('docs.forward.entry')).not.toBeNull())
    // Open the ≡ menu and confirm the twin menu row is also present.
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    expect(screen.queryByRole('menuitem', { name: /docs\.forward\.entry/ })).toBeTruthy()
  })

  it('renders the Forward button once role resolves (reader suffices; the guard is role != null)', async () => {
    // Guard against over-tightening: any resolved role must restore the button. reader is the
    // weakest positive case — sharing-only forward (canGrant=false) still needs the entry.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d1') {
        return { data: { docId: 'd1', ownerId: 'u_owner', role: 'reader' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    serveDoc('<p>body</p>', { title: 'My Doc' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="the-slug" version="v2" />)
    await waitForFrame(container)
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d1')).toBe(true))
    await waitFor(() => expect(screen.queryByTitle('docs.forward.entry')).not.toBeNull())
    expect(container.querySelector('.octo-doc-forward-btn')).toBeTruthy()
  })

  it('offers delete only to the author in the ≡ menu', async () => {
    // Non-author: open the ≡ menu → no delete row.
    serveDoc('<p>body</p>', { creator_uid: 'u_other' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    expect(screen.queryByText('docs.doc.deleteEntry')).toBeNull()
    // The neutral rows are present.
    expect(screen.getByText('docs.standalone.openInNewPage')).toBeTruthy()
  })

  it('offers delete to the author in the ≡ menu', async () => {
    serveDoc('<p>body</p>', { creator_uid: 'u_owner' }, { isAuthor: true })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    expect(screen.getByText('docs.doc.deleteEntry')).toBeTruthy()
  })

  it.each([200, 404])('soft-deletes the HTML doc through /docs/{docId} on %i', async (status) => {
    wk.apiClient.responder = (method) => {
      if (method === 'delete' && status === 404) throw { response: { status } }
      return { data: {}, status: 200 }
    }
    const rawFetch = serveDoc('<p>body</p>', { creator_uid: 'u_owner' }, { isAuthor: true })
    const onDeleted = vi.fn()
    const { container } = render(
      <HtmlDocView docId="d_html" space="sp" slug="published-slug" onDeleted={onDeleted} />,
    )
    await waitForFrame(container)
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    fireEvent.click(screen.getByText('docs.doc.deleteEntry'))
    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.delete' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('d_html'))
    expect(wk.apiClient.calls).toContainEqual(
      expect.objectContaining({
        method: 'delete',
        url: '/docs/d_html',
        config: expect.objectContaining({
          headers: expect.objectContaining({ 'X-Space-Id': 'sp' }),
        }),
      }),
    )
    expect(
      rawFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'),
    ).toBe(false)
  })

  it.each([
    [403, 'docs.doc.deleteForbidden'],
    [409, 'docs.doc.deleteArchived'],
    [500, 'docs.doc.deleteFailed'],
  ])('shows the shared delete error after the confirm closes on %i', async (status, errorKey) => {
    wk.apiClient.responder = (method) => {
      if (method === 'delete') throw { response: { status } }
      return { data: {}, status: 200 }
    }
    const rawFetch = serveDoc('<p>body</p>', { creator_uid: 'u_owner' }, { isAuthor: true })
    const onDeleted = vi.fn()
    const { container } = render(
      <HtmlDocView docId="d_html" space="sp" slug="published-slug" onDeleted={onDeleted} />,
    )
    await waitForFrame(container)
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    fireEvent.click(screen.getByText('docs.doc.deleteEntry'))
    fireEvent.click(screen.getByRole('button', { name: 'docs.comment.delete' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(errorKey))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onDeleted).not.toHaveBeenCalled()
    expect(wk.apiClient.calls).toContainEqual(
      expect.objectContaining({ method: 'delete', url: '/docs/d_html' }),
    )
    expect(
      rawFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'),
    ).toBe(false)
  })

  it('hides the delete affordance from an admin-not-author viewer', async () => {
    // The existing HTML author gate remains independent from the docs-backend role.
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d1') {
        return { data: { docId: 'd1', ownerId: 'u_owner', role: 'admin' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    serveDoc('<p>body</p>', { creator_uid: 'u_owner' }, { isAuthor: false })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="the-slug" />)
    await waitForFrame(container)
    // Wait for docs-backend role=admin to land so canManageBackend is true (canOpenPanel would
    // therefore render the entry pre-fix); the assertion below then proves the gate is isAuthor,
    // not canOpenPanel.
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d1')).toBe(true))
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    expect(screen.queryByText('docs.doc.deleteEntry')).toBeNull()
    // Neutral rows should still be there so we know the menu opened.
    expect(screen.getByText('docs.standalone.openInNewPage')).toBeTruthy()
  })

  it('injects a <base> into the iframe srcdoc so CSS/relative assets resolve to the doc origin', async () => {
    serveDoc('<html><head></head><body><p>body</p></body></html>')
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    expect(frame.getAttribute('srcdoc')).toContain('<base href="https://od.test/">')
  })
})

describe('HtmlDocView — creator/created head sourced from docs-backend (OCT-194)', () => {
  let wk: ReturnType<typeof createMockWKApp>

  function serveDoc(htmlBody: string) {
    // Header-only tests: the __ODOC__ / __ODOC_CAP__ inline blobs are irrelevant here because the
    // creator display now reads exclusively from docs-backend (getDoc + getUserName).
    return stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse(htmlBody)
    })
  }

  beforeEach(() => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
    wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    setWKApp(wk)
  })
  afterEach(() => {
    delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
    setWKApp(undefined as never)
  })

  it('renders the creator name (from getUserName) and created-on date (from getDoc.createdAt) in the ≡ menu head', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d1') {
        return {
          data: { docId: 'd1', ownerId: 'u_owner', createdAt: '2026-07-15T04:09:00Z' },
          status: 200,
        }
      }
      if (method === 'get' && url === '/users/u_owner') {
        return { data: { name: 'Nick', real_name: 'Alice Owner' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    serveDoc('<p>body</p>')
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/users/u_owner')).toBe(true))
    // Open the ≡ menu.
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    // In-shell (creatorNicknameOnly unset) prefers real_name — the verified name lands in the head.
    await waitFor(() => expect(screen.getByText('Alice Owner')).toBeTruthy())
    // Created-on is a lexical YYYY-MM-DD slice (no tz drift).
    expect(screen.getByText(/2026-07-15/)).toBeTruthy()
  })

  it('passes X-Space-Id on the docs-backend GET so the standalone /d/:docId space-required middleware accepts it', async () => {
    wk.apiClient.responder = () => ({ data: {}, status: 200 })
    serveDoc('<p>body</p>')
    render(<HtmlDocView docId="d1" space="sp_42" />)
    await waitFor(() => {
      const call = wk.apiClient.calls.find((c) => c.url === '/docs/d1')
      expect(call).toBeTruthy()
      expect(call?.config?.headers).toMatchObject({ 'X-Space-Id': 'sp_42' })
    })
  })

  it('standalone (creatorNicknameOnly) resolves nickname-only — real_name never surfaces to the link holder', async () => {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d1') {
        return { data: { docId: 'd1', ownerId: 'u_owner' }, status: 200 }
      }
      if (method === 'get' && url === '/users/u_owner') {
        // Server returns both; the standalone surface must ignore real_name (preferRealName:false).
        return { data: { name: 'Nick', real_name: 'Real Legal Name' }, status: 200 }
      }
      return { data: {}, status: 200 }
    }
    serveDoc('<p>body</p>')
    const { container } = render(<HtmlDocView docId="d1" space="sp" creatorNicknameOnly />)
    await waitForFrame(container)
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/users/u_owner')).toBe(true))
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    await waitFor(() => expect(screen.getByText('Nick')).toBeTruthy())
    expect(screen.queryByText('Real Legal Name')).toBeNull()
  })

  it('fails soft when docs-backend rejects (404/network) — header falls back to slug initial, ≡ menu still opens, no crash', async () => {
    wk.apiClient.responder = () => Promise.reject(new Error('not found'))
    serveDoc('<p>body</p>')
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="the-slug" />)
    await waitForFrame(container)
    // Header title falls through to the slug (no meta.title).
    expect(container.querySelector('.octo-html-doc-title')?.textContent).toBe('the-slug')
    // ≡ menu opens without crashing; the creator row shows the '—' placeholder (ownerId undefined).
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    expect(document.querySelector('.octo-doc-more-name')?.textContent).toBe('—')
  })

  it('OCT-198 regression: standalone slug≠docId hits docs-backend by docId (not slug); owner/created/role resolve', async () => {
    // StandaloneDocPage passes docId=meta.docId + slug=meta.octoDocSlug as TWO different ids.
    // The bug: getDoc was called with effectiveSlug (=slug), so `/docs/{slug}` 404'd and silently
    // wiped ownerId/createdAt/role — creator display + forward授权 broke on every published html
    // doc with a distinct octo-doc slug. Guard the fix: docs-backend receives docId, slug is
    // reserved for octo-doc render (`/d/{slug}/v/{ver}`) + comment/asset/grant paths.
    wk.apiClient.responder = (method, url) => {
      // docs-backend keyed by docId. A slug-shaped call here is the pre-fix bug returning.
      if (method === 'get' && url === '/docs/doc_abc') {
        return {
          data: { docId: 'doc_abc', ownerId: 'u_owner', role: 'admin', createdAt: '2026-07-20T00:00:00Z' },
          status: 200,
        }
      }
      if (method === 'get' && url === '/users/u_owner') {
        return { data: { name: 'Nick', real_name: 'Alice Owner' }, status: 200 }
      }
      // Explicit trap: a call to `/docs/{slug}` means the bug regressed.
      if (method === 'get' && url === '/docs/published-slug-xyz') {
        throw new Error('OCT-198 regression: getDoc called with slug instead of docId')
      }
      return { data: {}, status: 200 }
    }
    serveDoc('<p>body</p>')
    const { container } = render(
      <HtmlDocView docId="doc_abc" space="sp_1" slug="published-slug-xyz" version="v2" />
    )
    await waitForFrame(container)
    // 1) docs-backend addressed by docId, never by slug.
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/doc_abc')).toBe(true))
    expect(wk.apiClient.calls.some((c) => c.url === '/docs/published-slug-xyz')).toBe(false)
    // 2) octo-doc render path still uses the slug (unchanged).
    const octoCalls = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
    expect(octoCalls.some(([u]) => String(u).includes('/d/published-slug-xyz/v/v2'))).toBe(true)
    // 3) ownerId/createdAt/role landed — so the creator name resolves and forward授权 unblocks.
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/users/u_owner')).toBe(true))
    fireEvent.click(container.querySelector('.octo-doc-more-btn') as HTMLElement)
    await waitFor(() => expect(screen.getByText('Alice Owner')).toBeTruthy())
    expect(screen.getByText(/2026-07-20/)).toBeTruthy()
  })
})

describe('HtmlDocView — Members panel gate (author OR admin)', () => {
  let wk: ReturnType<typeof createMockWKApp>

  // Serves an octo-doc HTML body with an optional __ODOC_CAP__ authorship marker. Mirrors
  // serveDoc from the "header parity" suite; kept local so this suite owns its fetch stub.
  function serveDoc(opts?: { isAuthor?: boolean }) {
    const cap =
      opts?.isAuthor === undefined
        ? ''
        : `<script>window.__ODOC_CAP__ = {isAuthor: ${opts.isAuthor ? 'true' : 'false'}};</script>`
    return stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse(`${cap}<p>body</p>`)
    })
  }

  // Docs-backend responder that pins the current viewer's role for the /docs/d1 hop. role=null
  // (undefined) mirrors "still loading / no doc_meta"; role='admin'|'writer'|'reader' pins a
  // resolved role. ownerId is decoupled from viewer uid so isAuthor is driven purely by __ODOC_CAP__.
  function mockRole(role: 'admin' | 'writer' | 'reader' | null) {
    wk.apiClient.responder = (method, url) => {
      if (method === 'get' && url === '/docs/d1') {
        return {
          data: { docId: 'd1', ownerId: 'u_owner', ...(role ? { role } : {}) },
          status: 200,
        }
      }
      return { data: {}, status: 200 }
    }
  }

  beforeEach(() => {
    ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
    wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    setWKApp(wk)
  })
  afterEach(() => {
    delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
    setWKApp(undefined as never)
  })

  it('opens the panel for the author even when role is still null (fail-soft short-circuit)', async () => {
    // isAuthor=true short-circuits before role is inspected, so a never-resolving getDoc must not
    // block the panel from opening. Guards the "role=null" branch of decision #2.
    wk.apiClient.responder = () => new Promise(() => {})
    serveDoc({ isAuthor: true })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    fireEvent.click(screen.getByTitle('docs.toolbar.members'))
    expect(container.querySelector('.octo-modal-overlay .octo-modal')).toBeTruthy()
    expect(container.querySelector('.octo-member-panel')).toBeTruthy()
  })

  it('opens the panel for a non-author admin (docs-backend role gate)', async () => {
    mockRole('admin')
    serveDoc({ isAuthor: false })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d1')).toBe(true))
    // Button must render only after role resolves — wait for it rather than snapshotting.
    const btn = await waitFor(() => screen.getByTitle('docs.toolbar.members'))
    fireEvent.click(btn)
    expect(container.querySelector('.octo-modal-overlay .octo-modal')).toBeTruthy()
    expect(container.querySelector('.octo-member-panel')).toBeTruthy()
  })

  it('hides the panel entry for a non-author reader', async () => {
    mockRole('reader')
    serveDoc({ isAuthor: false })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d1')).toBe(true))
    // Even after the role settles, the button must not appear (reader has no manage capability
    // on either backend authority).
    expect(screen.queryByTitle('docs.toolbar.members')).toBeNull()
    expect(container.querySelector('.octo-modal-overlay')).toBeNull()
  })

  it('hides the panel entry for a non-author writer', async () => {
    mockRole('writer')
    serveDoc({ isAuthor: false })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    await waitFor(() => expect(wk.apiClient.calls.some((c) => c.url === '/docs/d1')).toBe(true))
    expect(screen.queryByTitle('docs.toolbar.members')).toBeNull()
  })

  it('hides the panel entry when role is still null and the viewer is not the author (fail-soft)', async () => {
    // Never-resolving getDoc keeps role=null; a non-author must NOT get the button on loading state
    // (decision #2 fail-soft: `role != null && canManage(role)` short-circuits to false).
    wk.apiClient.responder = () => new Promise(() => {})
    serveDoc({ isAuthor: false })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    expect(screen.queryByTitle('docs.toolbar.members')).toBeNull()
    expect(container.querySelector('.octo-modal-overlay')).toBeNull()
  })
})

describe('HtmlDocView — coalesced selection bound to bridge generation (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function commenter() {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
  }

  async function mountReadyFrame(html: string) {
    stubFetch((url) => (url.includes('/comments') ? jsonResponse({ data: [] }) : htmlResponse(html)))
    const { container, rerender } = render(<HtmlDocView docId="d1" space="sp" />)
    // Drive the async fetch + role resolution to completion under fake timers.
    await vi.waitFor(() => {
      const f = container.querySelector('iframe.octo-html-doc-frame') as HTMLIFrameElement | null
      expect(f).toBeTruthy()
      return f as HTMLIFrameElement
    })
    const frame = container.querySelector('iframe.octo-html-doc-frame') as HTMLIFrameElement
    fireEvent.load(frame)
    await vi.waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())
    return { container, rerender, frame }
  }

  it('drops an old-generation queued selection after the frame reloads before the flush', async () => {
    commenter()
    const { container, frame } = await mountReadyFrame('<p data-odoc-aid="a1">one</p>')

    // Queue a selection under generation A but do NOT let the 60ms flush fire yet.
    bridgeSelection(frame, { kind: 'element', aid: 'a1', selector: '[data-odoc-aid="a1"]', label: 'p' })
    // Frame reloads (a new generation) before the coalesce timer elapses.
    fireEvent.load(frame)
    // Advance past the coalesce window: the gen-A anchor is stale and must be dropped.
    await vi.advanceTimersByTimeAsync(120)
    expect(screen.getByTestId('pending-anchor').textContent).not.toContain('#a1')
    expect(screen.getByTestId('pending-anchor').textContent).toContain('docs.comment.targetDoc')

    // A fresh selection under the current generation still flushes normally.
    bridgeSelection(frame, { kind: 'element', aid: 'a1', selector: '[data-odoc-aid="a1"]', label: 'p' })
    await vi.advanceTimersByTimeAsync(120)
    expect(screen.getByTestId('pending-anchor').textContent).toContain('#a1')
    expect(container.querySelector('iframe.octo-html-doc-frame')).toBe(frame)
  })

  it('drops a queued selection when code mode is entered before the flush', async () => {
    commenter()
    const { frame } = await mountReadyFrame('<p data-odoc-aid="a1">one</p>')
    bridgeSelection(frame, { kind: 'element', aid: 'a1', selector: '[data-odoc-aid="a1"]', label: 'p' })
    // Switch to code mode within the coalesce window (mayCommentRef → false).
    fireEvent.click(screen.getByRole('tab', { name: 'docs.mode.code' }))
    await vi.advanceTimersByTimeAsync(120)
    // Code mode has no pending-anchor UI; switching back must not show the dropped anchor.
    fireEvent.click(screen.getByRole('tab', { name: 'docs.mode.page' }))
    await vi.waitFor(() => expect(screen.queryByTestId('pending-anchor')).toBeTruthy())
    expect(screen.getByTestId('pending-anchor').textContent).not.toContain('#a1')
  })

  it('drops a queued selection when commenting permission is removed before the flush', async () => {
    let role: 'commenter' | 'reader' = 'commenter'
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => (url.includes('/comments') ? jsonResponse({ data: [] }) : htmlResponse('<p data-odoc-aid="a1">one</p>')))
    const { container, rerender } = render(<HtmlDocView docId="d1" space="sp1" />)
    await vi.waitFor(() => expect(container.querySelector('iframe.octo-html-doc-frame')).toBeTruthy())
    const frame = container.querySelector('iframe.octo-html-doc-frame') as HTMLIFrameElement
    fireEvent.load(frame)
    await vi.waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())

    // Queue a selection under commenter, then demote to reader within the coalesce window. The
    // commenting-off effect cancels the queued flush, so the demoted human never gets the anchor.
    bridgeSelection(frame, { kind: 'element', aid: 'a1', selector: '[data-odoc-aid="a1"]', label: 'p' })
    role = 'reader'
    rerender(<HtmlDocView docId="d1" space="sp2" />)
    await vi.waitFor(() => expect(screen.queryByPlaceholderText('docs.comment.placeholder')).toBeNull())
    await vi.advanceTimersByTimeAsync(120)
    // Reader has no pending-anchor UI; the queued anchor was dropped, not committed.
    expect(screen.queryByTestId('pending-anchor')).toBeNull()
  })

  it('honors a queued selection that arrives before the composer engages, and freezes one that engages during the delay', async () => {
    commenter()
    const { frame } = await mountReadyFrame('<p data-odoc-aid="good">good</p><p data-odoc-aid="evil">evil</p>')

    // First selection queued, composer NOT engaged: it flushes and is adopted.
    bridgeSelection(frame, { kind: 'element', aid: 'good', selector: '[data-odoc-aid="good"]', label: 'p' })
    await vi.advanceTimersByTimeAsync(120)
    expect(screen.getByTestId('pending-anchor').textContent).toContain('#good')

    // Queue a swap, then engage the composer during the coalesce delay: the flush must re-check
    // engagement and drop the swap (still #good, never #evil).
    bridgeSelection(frame, { kind: 'element', aid: 'evil', selector: '[data-odoc-aid="evil"]', label: 'p' })
    fireEvent.focus(screen.getByPlaceholderText('docs.comment.placeholder'))
    await vi.advanceTimersByTimeAsync(120)
    expect(screen.getByTestId('pending-anchor').textContent).toContain('#good')
    expect(screen.getByTestId('pending-anchor').textContent).not.toContain('#evil')
  })
})

describe('HtmlDocView — composer engagement reset across transitions', () => {
  function commenter() {
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role: 'commenter' }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
  }

  it('accepts a fresh selection after the comment panel is closed and reopened (engagement reset)', async () => {
    commenter()
    stubFetch((url) => (url.includes('/comments') ? jsonResponse({ data: [] }) : htmlResponse('<p data-odoc-aid="a1">one</p><p data-odoc-aid="a2">two</p>')))
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())

    // Engage the composer (focus + draft), then close the panel: the panel's cleanup reports
    // engaged=false so the parent's freeze is released.
    const input = screen.getByPlaceholderText('docs.comment.placeholder')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'draft' } })
    fireEvent.click(screen.getByTitle('docs.toolbar.comments')) // close panel (unmount)
    await waitFor(() => expect(screen.queryByTestId('html-doc-comment-panel')).toBeNull())

    // Reopen the panel; a fresh selection is honored (not frozen by a stale engaged=true).
    fireEvent.click(screen.getByTitle('docs.toolbar.comments'))
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())
    bridgeSelection(frame, { kind: 'element', aid: 'a2', selector: '[data-odoc-aid="a2"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a2'))
  })

  it('accepts a fresh selection after a code→page mode round-trip while a draft was held', async () => {
    commenter()
    stubFetch((url) => (url.includes('/comments') ? jsonResponse({ data: [] }) : htmlResponse('<p data-odoc-aid="a1">one</p><p data-odoc-aid="a2">two</p>')))
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())

    const input = screen.getByPlaceholderText('docs.comment.placeholder')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'draft' } })
    // Code mode drops the composer + resets engagement; page mode reloads the frame.
    fireEvent.click(screen.getByRole('tab', { name: 'docs.mode.code' }))
    fireEvent.click(screen.getByRole('tab', { name: 'docs.mode.page' }))
    const nextFrame = await waitForFrame(container)
    fireEvent.load(nextFrame)
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())
    bridgeSelection(nextFrame, { kind: 'element', aid: 'a2', selector: '[data-odoc-aid="a2"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a2'))
  })

  it('accepts a fresh selection after a permission demotion→re-promotion (engagement reset)', async () => {
    let role: 'commenter' | 'reader' = 'commenter'
    const wk = createMockWKApp({ uid: 'u_viewer', token: 't' })
    wk.apiClient.responder = (method, url) =>
      method === 'get' && url === '/docs/d1'
        ? { data: { docId: 'd1', ownerId: 'u_owner', role }, status: 200 }
        : { data: {}, status: 200 }
    setWKApp(wk)
    stubFetch((url) => (url.includes('/comments') ? jsonResponse({ data: [] }) : htmlResponse('<p data-odoc-aid="a1">one</p><p data-odoc-aid="a2">two</p>')))
    const { container, rerender } = render(<HtmlDocView docId="d1" space="sp1" />)
    const frame = await waitForFrame(container)
    fireEvent.load(frame)
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())

    // Engage, then demote to reader: commenting-off resets engagement + clears the anchor.
    const input = screen.getByPlaceholderText('docs.comment.placeholder')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'draft' } })
    role = 'reader'
    rerender(<HtmlDocView docId="d1" space="sp2" />)
    await waitFor(() => expect(screen.queryByPlaceholderText('docs.comment.placeholder')).toBeNull())

    // Re-promote to commenter (same frame); a fresh selection is honored again.
    role = 'commenter'
    rerender(<HtmlDocView docId="d1" space="sp3" />)
    await waitFor(() => expect(screen.getByPlaceholderText('docs.comment.placeholder')).toBeTruthy())
    expect(container.querySelector('iframe.octo-html-doc-frame')).toBe(frame)
    bridgeSelection(frame, { kind: 'element', aid: 'a2', selector: '[data-odoc-aid="a2"]', label: 'p' })
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a2'))
  })
})
