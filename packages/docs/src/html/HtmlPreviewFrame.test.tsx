import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { HtmlPreviewFrame } from './HtmlPreviewFrame.tsx'
import { injectBaseHref, resolveAbsoluteOctoDocBase } from './htmlDocFrameHelpers.ts'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// HtmlPreviewFrame fetches published octo-doc HTML from a SEPARATE backend, so we stub global
// fetch (not the octoweb apiClient) — mirroring the component's raw-fetch design.
function stubFetch(body: string, ok = true, status = 200) {
  const spy = vi.fn(() =>
    Promise.resolve({ ok, status, text: async () => body } as unknown as Response)
  ) as unknown as typeof fetch
  vi.stubGlobal('fetch', spy)
  return spy
}

async function waitForFrame(container: HTMLElement): Promise<HTMLIFrameElement> {
  return waitFor(() => {
    const f = container.querySelector('iframe') as HTMLIFrameElement | null
    if (!f) throw new Error('no iframe yet')
    return f
  })
}

beforeEach(() => setWKApp(createMockWKApp({ uid: 'u', token: 't' })))
afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

describe('HtmlPreviewFrame — sandbox isolation (issue #27)', () => {
  it('scripts mode: EXACT sandbox="allow-scripts", never allow-same-origin', async () => {
    stubFetch('<html><head></head><body><p>x</p></body></html>')
    const { container } = render(<HtmlPreviewFrame slug="s" version="latest" title="t" isolation="scripts" />)
    const frame = await waitForFrame(container)
    // Exact token set — the dangerous allow-same-origin pairing (and forms/popups/downloads/top-nav)
    // must be absent.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  })

  it('sets referrerPolicy="no-referrer" so the page URL never leaks as a Referer (both modes)', async () => {
    // The sandbox does NOT stop outbound network from doc JS (accepted capability), so we cap the
    // one leak channel we own: never send our URL as a Referer on doc-initiated requests.
    stubFetch('<html><head></head><body><p>x</p></body></html>')
    const scripts = render(<HtmlPreviewFrame slug="s" version="latest" title="t" isolation="scripts" />)
    const sf = await waitForFrame(scripts.container)
    expect(sf.getAttribute('referrerpolicy')).toBe('no-referrer')
    scripts.unmount()
    stubFetch('<html><head></head><body><p>x</p></body></html>')
    const ro = render(<HtmlPreviewFrame slug="s" version="1" title="t" isolation="readonly-dom" />)
    const rf = await waitForFrame(ro.container)
    expect(rf.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('readonly-dom mode: EXACT sandbox="allow-same-origin", never allow-scripts', async () => {
    stubFetch('<html><head></head><body><p>x</p></body></html>')
    const { container } = render(<HtmlPreviewFrame slug="s" version="1" title="t" isolation="readonly-dom" />)
    const frame = await waitForFrame(container)
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
  })

  it('scripts mode injects the bridge into srcdoc; readonly-dom does NOT (and carries no scripts)', async () => {
    stubFetch('<html><head><style>.a{color:red}</style></head><body><p>hi</p></body></html>')
    const scripts = render(<HtmlPreviewFrame slug="s" version="latest" title="t" isolation="scripts" />)
    const sf = await waitForFrame(scripts.container)
    const scriptsDoc = sf.getAttribute('srcdoc') ?? ''
    expect(scriptsDoc).toContain('octodoc-bridge')
    // Author CSS is preserved verbatim.
    expect(scriptsDoc).toContain('.a{color:red}')
    scripts.unmount()

    stubFetch('<html><head><style>.a{color:red}</style></head><body><p>hi</p></body></html>')
    const ro = render(<HtmlPreviewFrame slug="s" version="1" title="t" isolation="readonly-dom" />)
    const rf = await waitForFrame(ro.container)
    const roDoc = rf.getAttribute('srcdoc') ?? ''
    // No bridge, and (readonly-dom) no <script> at all — the parent reads the DOM directly instead.
    expect(roDoc).not.toContain('octodoc-bridge')
    expect(roDoc).not.toMatch(/<script/i)
    // Author CSS still preserved.
    expect(roDoc).toContain('.a{color:red}')
  })

  it('scripts mode: the bridge precedes an author <meta CSP> in the built srcdoc (CSP ordering)', async () => {
    stubFetch(
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"></head><body></body></html>'
    )
    const { container } = render(<HtmlPreviewFrame slug="s" version="latest" title="t" isolation="scripts" />)
    const frame = await waitForFrame(container)
    const doc = frame.getAttribute('srcdoc') ?? ''
    expect(doc.indexOf('octodoc-bridge')).toBeGreaterThan(-1)
    expect(doc.indexOf('octodoc-bridge')).toBeLessThan(doc.indexOf('Content-Security-Policy'))
    // Author CSP is preserved for the rest of the document.
    expect(doc).toContain("script-src 'none'")
  })

  it('bridge unavailable (no DOMParser): srcdoc is the unbridged normalized HTML and onFrameLoad token is null', async () => {
    // injectBridgeScript AND absolutizeDocAssetUrls both fail closed to identity without DOMParser
    // (SSR); only injectBaseHref (regex) still runs. The frame must then mint NO token, embed NO
    // bridge, and hand onFrameLoad a null token — tokenRef stays in lockstep with the real srcDoc.
    const raw = '<html><head><style>.a{color:red}</style></head><body><p>hi</p></body></html>'
    // Capture the expected normalized srcDoc under the same (DOMParser-absent) conditions.
    const savedDOMParser = globalThis.DOMParser
    // @ts-expect-error deleting a global for the fail-closed path
    delete (globalThis as { DOMParser?: unknown }).DOMParser
    try {
      expect(typeof DOMParser).toBe('undefined')
      const expected = injectBaseHref(raw, resolveAbsoluteOctoDocBase())
      stubFetch(raw)
      const onFrameLoad = vi.fn()
      const { container } = render(
        <HtmlPreviewFrame slug="s" version="latest" title="t" isolation="scripts" onFrameLoad={onFrameLoad} />,
      )
      const frame = await waitForFrame(container)
      const srcdoc = frame.getAttribute('srcdoc') ?? ''
      // Byte-equivalent to the unbridged normalized HTML — no bridge, no token literal.
      expect(srcdoc).toBe(expected)
      expect(srcdoc).not.toContain('octodoc-bridge')
      expect(srcdoc).not.toMatch(/TOKEN = "/)
      // onLoad hands back a null token (bridge disabled), and doc is null in scripts mode.
      await waitFor(() => expect(onFrameLoad).toHaveBeenCalled())
      const [doc, , token] = onFrameLoad.mock.calls[0]
      expect(token).toBeNull()
      expect(doc).toBeNull()
    } finally {
      // Restore reliably so later tests keep a working DOMParser.
      ;(globalThis as { DOMParser?: unknown }).DOMParser = savedDOMParser
    }
    expect(typeof DOMParser).toBe('function')
  })

  it('embeds a fresh bridge token per load; two loads get different tokens', async () => {
    stubFetch('<html><head></head><body></body></html>')
    const first = render(<HtmlPreviewFrame slug="s" version="latest" title="t" isolation="scripts" />)
    const f1 = await waitForFrame(first.container)
    const t1 = /TOKEN = "([^"]*)"/.exec(f1.getAttribute('srcdoc') ?? '')?.[1]
    first.unmount()

    stubFetch('<html><head></head><body></body></html>')
    const second = render(<HtmlPreviewFrame slug="s" version="latest" title="t" isolation="scripts" />)
    const f2 = await waitForFrame(second.container)
    const t2 = /TOKEN = "([^"]*)"/.exec(f2.getAttribute('srcdoc') ?? '')?.[1]

    expect(t1).toBeTruthy()
    expect(t2).toBeTruthy()
    expect(t1).not.toBe(t2)
  })
})
