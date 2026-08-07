import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { HtmlPreviewFrame } from './HtmlPreviewFrame.tsx'
import {
  bindAnchorNavigation,
  buildAbsoluteOctoDocUrl,
  injectBaseHref,
} from './htmlDocFrameHelpers.ts'
import * as helpers from './htmlDocFrameHelpers.ts'
const actualBind = bindAnchorNavigation
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// HtmlPreviewFrame raw-fetches published HTML from the octo-doc backend; stub the global fetch.
function stubFetch(body: string) {
  const spy = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, text: async () => body } as Response),
  ) as unknown as typeof fetch
  vi.stubGlobal('fetch', spy)
  return spy as unknown as ReturnType<typeof vi.fn>
}

async function waitForFrame(container: HTMLElement): Promise<HTMLIFrameElement> {
  return waitFor(() => {
    const frame = container.querySelector('iframe') as HTMLIFrameElement | null
    expect(frame).toBeTruthy()
    return frame as HTMLIFrameElement
  })
}

// jsdom does not render srcDoc into contentDocument; write the body ourselves then fire load,
// mirroring the pattern used by HtmlDocView.test.tsx.
function writeIframeBody(iframe: HTMLIFrameElement, body: string): Document {
  const doc = iframe.contentDocument as Document
  doc.open()
  doc.write(`<!doctype html><html><head></head><body>${body}</body></html>`)
  doc.close()
  fireEvent.load(iframe)
  return doc
}

// Same as writeIframeBody but lets a test seed <head> markup (e.g. a real <base target>) so the
// effective-target resolution runs against a genuine DOM, not a mocked getter.
function writeIframeDoc(iframe: HTMLIFrameElement, head: string, body: string): Document {
  const doc = iframe.contentDocument as Document
  doc.open()
  doc.write(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`)
  doc.close()
  fireEvent.load(iframe)
  return doc
}

beforeEach(() => {
  setWKApp(createMockWKApp())
  ;(window as unknown as { __OCTO_DOC_BASE__?: string }).__OCTO_DOC_BASE__ = 'https://od.test'
})
afterEach(() => {
  cleanup()
  delete (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HtmlPreviewFrame — in-page anchor interception', () => {
  it('intercepts a bare #fragment click and scrolls instead of navigating the frame', async () => {
    stubFetch('<a id="lnk" href="#intro">go</a><section id="intro">Intro</section>')
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeBody(
      frame,
      '<a id="lnk" href="#intro">go</a><section id="intro">Intro</section>',
    )

    const target = doc.getElementById('intro') as HTMLElement
    const scrollSpy = vi.fn()
    target.scrollIntoView = scrollSpy

    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('lnk')!.dispatchEvent(evt)

    expect(evt.defaultPrevented).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
  })

  it('intercepts a click on an element nested inside the anchor (closest())', async () => {
    stubFetch('x')
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeBody(
      frame,
      '<a href="#intro"><span id="inner">go</span></a><h2 id="intro">Intro</h2>',
    )
    const target = doc.getElementById('intro') as HTMLElement
    const scrollSpy = vi.fn()
    target.scrollIntoView = scrollSpy

    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('inner')!.dispatchEvent(evt)

    expect(evt.defaultPrevented).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
  })

  it('preventDefaults even when the fragment target is missing (never navigates away)', async () => {
    stubFetch('x')
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeBody(frame, '<a id="lnk" href="#nope">go</a>')

    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
  })

  it('intercepts an <area href="#frag"> image-map click (closest a-only would miss it)', async () => {
    stubFetch('x')
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeBody(
      frame,
      '<map name="m"><area id="ar" shape="rect" coords="0,0,10,10" href="#intro"></map><section id="intro">Intro</section>',
    )
    const scrollSpy = vi.fn()
    ;(doc.getElementById('intro') as HTMLElement).scrollIntoView = scrollSpy

    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('ar')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
  })

  it('scrolls to an element with id="top" instead of jumping to the page top (#top swallow bug)', async () => {
    stubFetch('x')
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeBody(frame, '<a id="lnk" href="#top">go</a><section id="top">Top section</section>')
    const scrollSpy = vi.fn()
    ;(doc.getElementById('top') as HTMLElement).scrollIntoView = scrollSpy
    const scrollToSpy = vi.fn()
    ;(doc.defaultView as unknown as { scrollTo: unknown }).scrollTo = scrollToSpy

    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
    expect(scrollToSpy).not.toHaveBeenCalled()
  })

  it('falls back to page top for #top only when no id="top" element exists', async () => {
    stubFetch('x')
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeBody(frame, '<a id="lnk" href="#top">go</a><section id="intro">no top here</section>')
    const scrollToSpy = vi.fn()
    ;(doc.defaultView as unknown as { scrollTo: unknown }).scrollTo = scrollToSpy

    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(scrollToSpy).toHaveBeenCalledWith(0, 0)
  })

  it('resolves a same-document href-with-fragment (base points at the doc URL) as in-page', async () => {
    stubFetch('x')
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const docUrl = buildAbsoluteOctoDocUrl('s', '3')
    const doc = writeIframeBody(
      frame,
      `<a id="lnk" href="${docUrl}#intro">go</a><section id="intro">Intro</section>`,
    )
    const target = doc.getElementById('intro') as HTMLElement
    const scrollSpy = vi.fn()
    target.scrollIntoView = scrollSpy

    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
  })
})

describe('HtmlPreviewFrame — pass-through (must NOT intercept)', () => {
  function setup() {
    // Non-empty fetch body so the frame actually renders (empty raw => 'empty' state, no iframe).
    stubFetch('<a id="lnk">go</a>')
  }

  async function clickAndGetEvent(
    body: string,
    init: MouseEventInit,
    linkId = 'lnk',
  ): Promise<{ evt: MouseEvent }> {
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeBody(frame, body)
    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ...init,
    })
    doc.getElementById(linkId)!.dispatchEvent(evt)
    return { evt }
  }

  it('does not intercept target="_blank"', async () => {
    setup()
    const { evt } = await clickAndGetEvent(
      '<a id="lnk" target="_blank" href="#intro">go</a><i id="intro"></i>',
      { button: 0 },
    )
    expect(evt.defaultPrevented).toBe(false)
  })

  it('does not intercept a named target', async () => {
    setup()
    const { evt } = await clickAndGetEvent(
      '<a id="lnk" target="win" href="#intro">go</a><i id="intro"></i>',
      { button: 0 },
    )
    expect(evt.defaultPrevented).toBe(false)
  })

  it('does not intercept modified clicks (ctrl/meta/shift/alt)', async () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      setup()
      const { evt } = await clickAndGetEvent('<a id="lnk" href="#intro">go</a><i id="intro"></i>', {
        button: 0,
        ...mod,
      })
      expect(evt.defaultPrevented).toBe(false)
      cleanup()
    }
  })

  it('does not intercept middle-click (button !== 0)', async () => {
    setup()
    const { evt } = await clickAndGetEvent('<a id="lnk" href="#intro">go</a><i id="intro"></i>', {
      button: 1,
    })
    expect(evt.defaultPrevented).toBe(false)
  })

  it('does not intercept a cross-document link (different path)', async () => {
    setup()
    const { evt } = await clickAndGetEvent(
      '<a id="lnk" href="https://od.test/d/other/v/1#intro">go</a>',
      { button: 0 },
    )
    expect(evt.defaultPrevented).toBe(false)
  })

  it('does not intercept a plain external link with no fragment', async () => {
    setup()
    const { evt } = await clickAndGetEvent('<a id="lnk" href="https://example.com/">go</a>', {
      button: 0,
    })
    expect(evt.defaultPrevented).toBe(false)
  })

  it('does not intercept a fragment link under a real <base target="_blank">', async () => {
    setup()
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeDoc(
      frame,
      '<base target="_blank">',
      '<a id="lnk" href="#intro">go</a><i id="intro"></i>',
    )
    const link = doc.getElementById('lnk') as HTMLAnchorElement
    // Real <base target> — the element carries NO target attribute of its own, proving we resolve
    // the base rather than reading a (fictional) inherited anchor.target.
    expect(link.getAttribute('target')).toBeNull()
    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    link.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(false)
  })

  it('still intercepts and scrolls under a real <base target="_self">', async () => {
    setup()
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeDoc(
      frame,
      '<base target="_self">',
      '<a id="lnk" href="#intro">go</a><i id="intro"></i>',
    )
    const target = doc.getElementById('intro') as HTMLElement
    const scrollSpy = vi.fn()
    target.scrollIntoView = scrollSpy
    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
  })

  it('treats the reserved keyword case-insensitively: <base target="_SELF"> still scrolls in-page', async () => {
    setup()
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeDoc(
      frame,
      '<base target="_SELF">',
      '<a id="lnk" href="#intro">go</a><i id="intro"></i>',
    )
    const target = doc.getElementById('intro') as HTMLElement
    const scrollSpy = vi.fn()
    target.scrollIntoView = scrollSpy
    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
  })

  it('treats a whitespace-padded " _self " as a NAMED target and lets it through', async () => {
    setup()
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeDoc(
      frame,
      '<base target=" _self ">',
      '<a id="lnk" href="#intro">go</a><i id="intro"></i>',
    )
    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(false)
  })

  it('lets the element\u2019s own target="_self" override a <base target="_blank">', async () => {
    setup()
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeDoc(
      frame,
      '<base target="_blank">',
      '<a id="lnk" target="_self" href="#intro">go</a><i id="intro"></i>',
    )
    const target = doc.getElementById('intro') as HTMLElement
    const scrollSpy = vi.fn()
    target.scrollIntoView = scrollSpy
    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
  })

  it('lets an <area> under a real <base target="_blank"> through', async () => {
    setup()
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeDoc(
      frame,
      '<base target="_blank">',
      '<map name="m"><area id="ar" href="#intro" shape="rect" coords="0,0,1,1"></map><i id="intro"></i>',
    )
    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('ar')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(false)
  })

  it('resolves the target-bearing <base> even when a target-less <base> precedes it', async () => {
    setup()
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    // Mirrors production: our injected href-only <base> comes first; the author's <base target>
    // follows. We must find the one carrying target, not the first base.
    const doc = writeIframeDoc(
      frame,
      '<base href="https://od.test/d/s/v/3"><base target="_blank">',
      '<a id="lnk" href="#intro">go</a><i id="intro"></i>',
    )
    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(false)
  })

  it('does not intercept a link carrying a download attribute (browser handles the download)', async () => {
    setup()
    const { evt } = await clickAndGetEvent(
      '<a id="lnk" download href="#intro">go</a><i id="intro"></i>',
      { button: 0 },
    )
    expect(evt.defaultPrevented).toBe(false)
  })

  it('respects an already-defaultPrevented event', async () => {
    stubFetch('<a id="lnk">go</a>')
    const { container } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeBody(frame, '<a id="lnk" href="#intro">go</a><i id="intro"></i>')
    const target = doc.getElementById('intro') as HTMLElement
    const scrollSpy = vi.fn()
    target.scrollIntoView = scrollSpy
    // A listener registered first calls preventDefault; ours must then bail out.
    doc.getElementById('lnk')!.addEventListener('click', (e) => e.preventDefault())
    const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(scrollSpy).not.toHaveBeenCalled()
  })
})

describe('HtmlPreviewFrame — listener lifecycle', () => {
  // Wrap bindAnchorNavigation so each returned unbind records into unbindCalls when invoked.
  let unbindCalls: number[]
  beforeEach(() => {
    unbindCalls = []
    vi.spyOn(helpers, 'bindAnchorNavigation').mockImplementation((doc, url) => {
      const real = actualBind(doc, url)
      return () => {
        unbindCalls.push(1)
        real()
      }
    })
  })

  it('unbinds the old-document listener when slug changes (no intercept on the stale doc)', async () => {
    stubFetch('<a id="lnk" href="#intro">go</a><i id="intro"></i>')
    const { container, rerender } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const staleDoc = writeIframeBody(frame, '<a id="lnk" href="#intro">go</a><i id="intro"></i>')

    // Re-render with a new slug — the effect cleanup must drop the listener bound to staleDoc.
    rerender(<HtmlPreviewFrame slug="s2" version="3" title="t" />)
    await waitFor(() => expect(unbindCalls.length).toBeGreaterThan(0))

    const link = staleDoc.getElementById('lnk')
    if (link) {
      const evt = new (staleDoc.defaultView as Window & typeof globalThis).MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      })
      link.dispatchEvent(evt)
      expect(evt.defaultPrevented).toBe(false)
    }
    // Either the stale iframe DOM was torn down (link null) or the listener was removed; both prove
    // the old-document listener does not survive a slug change.
    expect(unbindCalls.length).toBeGreaterThan(0)
  })

  it('unbinds on unmount', async () => {
    stubFetch('<a id="lnk" href="#intro">go</a><i id="intro"></i>')
    const { container, unmount } = render(<HtmlPreviewFrame slug="s" version="3" title="t" />)
    const frame = await waitForFrame(container)
    const doc = writeIframeBody(frame, '<a id="lnk" href="#intro">go</a><i id="intro"></i>')
    const before = unbindCalls.length
    unmount()
    expect(unbindCalls.length).toBeGreaterThan(before)

    const link = doc.getElementById('lnk')
    if (link) {
      const evt = new (doc.defaultView as Window & typeof globalThis).MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      })
      link.dispatchEvent(evt)
      expect(evt.defaultPrevented).toBe(false)
    }
  })
})

describe('bindAnchorNavigation — unit (name= fallback + escaping)', () => {
  it('falls back to [name=...] when no id matches, escaping the value', () => {
    const doc = document.implementation.createHTMLDocument('t')
    doc.body.innerHTML = '<a id="lnk" href="#a.b">go</a><a name="a.b">anchor</a>'
    const named = doc.querySelectorAll('a')[1] as HTMLElement
    const scrollSpy = vi.fn()
    named.scrollIntoView = scrollSpy
    const unbind = bindAnchorNavigation(doc, 'https://od.test/d/s/v/3')

    const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(evt.defaultPrevented).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
    unbind()
  })

  it('decodes a percent-encoded fragment before lookup', () => {
    const doc = document.implementation.createHTMLDocument('t')
    doc.body.innerHTML = '<a id="lnk" href="#a%20b">go</a><h2 id="a b">x</h2>'
    const target = doc.getElementById('a b') as HTMLElement
    const scrollSpy = vi.fn()
    target.scrollIntoView = scrollSpy
    const unbind = bindAnchorNavigation(doc, 'https://od.test/d/s/v/3')
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
    unbind()
  })

  it('resolves a name= anchor with CSS-metacharacter/newline chars without throwing (getElementsByName, no selector build)', () => {
    // A raw selector built from this name would abort querySelector after preventDefault, leaving
    // the click stranded (no scroll, no navigation). getElementsByName sidesteps the selector.
    const doc = document.implementation.createHTMLDocument('t')
    const rawName = 'a\nb"]:c'
    doc.body.innerHTML = '<a id="lnk">go</a>'
    const named = doc.createElement('a')
    named.setAttribute('name', rawName)
    doc.body.appendChild(named)
    doc.getElementById('lnk')!.setAttribute('href', `#${encodeURIComponent(rawName)}`)
    const scrollSpy = vi.fn()
    named.scrollIntoView = scrollSpy
    const unbind = bindAnchorNavigation(doc, 'https://od.test/d/s/v/3')
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    expect(() => doc.getElementById('lnk')!.dispatchEvent(evt)).not.toThrow()
    expect(evt.defaultPrevented).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'start' })
    unbind()
  })

  it('unbind() removes the listener', () => {
    const doc = document.implementation.createHTMLDocument('t')
    doc.body.innerHTML = '<a id="lnk" href="#intro">go</a><i id="intro"></i>'
    const target = doc.getElementById('intro') as HTMLElement
    const scrollSpy = vi.fn()
    target.scrollIntoView = scrollSpy
    const unbind = bindAnchorNavigation(doc, 'https://od.test/d/s/v/3')
    unbind()
    const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    doc.getElementById('lnk')!.dispatchEvent(evt)
    expect(scrollSpy).not.toHaveBeenCalled()
  })
})

describe('injectBaseHref — document-self base (no forced trailing slash)', () => {
  it('inserts the doc render URL verbatim, not the directory root', () => {
    const docUrl = buildAbsoluteOctoDocUrl('s', '3')
    const out = injectBaseHref('<html><head></head><body>x</body></html>', docUrl)
    expect(out).toContain(`<base href="${docUrl}">`)
    expect(docUrl).toContain('/d/s/v/3')
    // Must NOT be turned into a directory (…/v/3/) — that would shift relative resolution.
    expect(out).not.toContain('/v/3/">')
  })
})
