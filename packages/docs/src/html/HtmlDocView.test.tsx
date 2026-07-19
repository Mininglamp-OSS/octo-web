import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

function selectNodeTextInDocument(doc: Document, node: Node) {
  const range = doc.createRange()
  range.selectNodeContents(node)
  const sel = doc.getSelection?.() ?? doc.defaultView?.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
  doc.dispatchEvent(new Event('selectionchange'))
}

function writeIframeBody(iframe: HTMLIFrameElement, body: string): Document {
  const doc = iframe.contentDocument as Document
  doc.open()
  doc.write(`<!doctype html><html><body>${body}</body></html>`)
  doc.close()
  fireEvent.load(iframe)
  return doc
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
})

afterEach(() => {
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
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts')
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

  it('keeps raw HTML in srcdoc while sandbox blocks scripts from running', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<p>safe body</p><script>window.__pwned = 1</script>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    expect(frame.getAttribute('srcdoc')).toContain('<script>window.__pwned = 1</script>')
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts')
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

    writeIframeBody(frame, '<p data-odoc-aid="a4">quoted paragraph from iframe</p>')

    await waitFor(() => expect(screen.getByTestId('comment-quote').textContent).toBe('quoted paragraph from iframe'))
  })

  it('keeps a selected anchor locked when selection collapses after focusing the comment input', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<p data-odoc-aid="a1">selected words</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    const frameDoc = writeIframeBody(frame, '<p data-odoc-aid="a1">selected words</p>')
    const anchored = frameDoc.querySelector('p') as HTMLElement

    selectNodeTextInDocument(frameDoc, anchored.firstChild ?? anchored)
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a1'))

    const input = screen.getByPlaceholderText('docs.comment.placeholder')
    fireEvent.focus(input)
    frameDoc.getSelection()?.removeAllRanges()
    frameDoc.dispatchEvent(new Event('selectionchange'))

    expect(screen.getByTestId('pending-anchor').textContent).toContain('#a1')
  })

  it('clears the locked anchor only through the explicit target cancel action', async () => {
    stubFetch((url) => {
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<p data-odoc-aid="a2">clearable words</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    const frameDoc = writeIframeBody(frame, '<p data-odoc-aid="a2">clearable words</p>')
    const anchored = frameDoc.querySelector('p') as HTMLElement

    selectNodeTextInDocument(frameDoc, anchored.firstChild ?? anchored)
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a2'))

    fireEvent.click(screen.getByText('docs.comment.clearAnchor'))

    expect(screen.getByTestId('pending-anchor').textContent).toContain('docs.comment.targetDoc')
    expect(screen.getByTestId('pending-anchor').textContent).not.toContain('#a2')
  })

  it('submits a comment with the locked anchor after the selection collapses', async () => {
    const spy = stubFetch((url, init) => {
      if ((init?.method ?? 'GET') === 'POST') return jsonResponse({ id: 'new1' })
      if (url.includes('/comments')) return jsonResponse({ data: [] })
      return htmlResponse('<p data-odoc-aid="a3">post anchored words</p>')
    })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="slug-1" version="v4" />)
    const frame = await waitForFrame(container)
    const frameDoc = writeIframeBody(frame, '<p data-odoc-aid="a3">post anchored words</p>')
    const anchored = frameDoc.querySelector('p') as HTMLElement

    selectNodeTextInDocument(frameDoc, anchored.firstChild ?? anchored)
    await waitFor(() => expect(screen.getByTestId('pending-anchor').textContent).toContain('#a3'))

    const input = screen.getByPlaceholderText('docs.comment.placeholder')
    fireEvent.focus(input)
    frameDoc.getSelection()?.removeAllRanges()
    frameDoc.dispatchEvent(new Event('selectionchange'))
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
    expect(body.anchor).toMatchObject({ kind: 'element', aid: 'a3' })
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

describe('injectBaseHref', () => {
  it('inserts <base> at the START of an existing <head> with a trailing-slash href', () => {
    const out = injectBaseHref('<html><head><title>t</title></head><body>x</body></html>', 'https://od.test')
    expect(out).toContain('<head><base href="https://od.test/">')
    // Only one base, and it precedes the original head content.
    expect(out.indexOf('<base')).toBeLessThan(out.indexOf('<title>'))
  })

  it('preserves an already-trailing slash and prepends <base> when there is no <head>', () => {
    const out = injectBaseHref('<p>no head</p>', 'https://od.test/')
    expect(out).toBe('<base href="https://od.test/"><p>no head</p>')
  })

  it('is a no-op when baseUrl is empty', () => {
    expect(injectBaseHref('<p>x</p>', '')).toBe('<p>x</p>')
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

  it('renders exactly one viewer avatar and no Synced/Connecting connection text', async () => {
    serveDoc('<p>body</p>')
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    await waitForFrame(container)
    const presence = screen.getByTestId('html-doc-presence')
    expect(presence.querySelectorAll('.octo-avatar')).toHaveLength(1)
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

  it('forwards the whole-doc link via openDocForward from the header forward button', async () => {
    serveDoc('<p>body</p>', { title: 'My Doc' })
    const { container } = render(<HtmlDocView docId="d1" space="sp" slug="the-slug" version="v2" />)
    await waitForFrame(container)
    fireEvent.click(screen.getByTitle('docs.forward.entry'))
    expect(wk.openDocForwardCalls).toHaveLength(1)
    expect(wk.openDocForwardCalls[0]).toMatchObject({ docId: 'd1', title: 'My Doc', canGrant: false })
    expect(typeof wk.openDocForwardCalls[0].link).toBe('string')
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

  it('injects a <base> into the iframe srcdoc so CSS/relative assets resolve to the doc origin', async () => {
    serveDoc('<html><head></head><body><p>body</p></body></html>')
    const { container } = render(<HtmlDocView docId="d1" space="sp" />)
    const frame = await waitForFrame(container)
    expect(frame.getAttribute('srcdoc')).toContain('<base href="https://od.test/">')
  })
})
