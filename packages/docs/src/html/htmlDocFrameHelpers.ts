export function resolveOctoDocBase(): string {
  const runtime =
    typeof window !== 'undefined' ? (window as unknown as { __OCTO_DOC_BASE__?: unknown }).__OCTO_DOC_BASE__ : undefined
  if (typeof runtime === 'string' && runtime.trim()) return runtime.trim().replace(/\/+$/, '')
  const env =
    typeof import.meta !== 'undefined'
      ? (import.meta as unknown as { env?: { VITE_OCTO_DOC_BASE?: string } }).env?.VITE_OCTO_DOC_BASE
      : undefined
  if (typeof env === 'string' && env.trim()) return env.trim().replace(/\/+$/, '')
  return '/docs-html'
}

export function resolveAbsoluteOctoDocBase(): string {
  const pageOrigin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost'
  return new URL(resolveOctoDocBase() || '/', `${pageOrigin}/`).href.replace(/\/+$/, '')
}

export function buildOctoDocUrl(slug: string, version: string): string {
  return `${resolveOctoDocBase()}/d/${encodeURIComponent(slug)}/v/${encodeURIComponent(version)}`
}

// Absolute render URL of the document itself (not the directory root). Used as the <base> so a
// bare fragment resolves against THIS document — the file-style path also gives correct relative
// (./x, ../x) asset resolution.
export function buildAbsoluteOctoDocUrl(slug: string, version: string): string {
  return resolveAbsoluteUrl(buildOctoDocUrl(slug, version))
}

function resolveAbsoluteUrl(value: string): string {
  const pageOrigin =
    typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost'
  return new URL(value || '/', `${pageOrigin}/`).href
}

function isAbsoluteOrSpecialUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith('//') || value.startsWith('#')
}

function resolveDocAssetUrl(value: string, docUrl: string, basePrefix = ''): string | null {
  if (!value || isAbsoluteOrSpecialUrl(value)) return null
  try {
    const docPath = new URL(docUrl).pathname
    const underPrefix = !!basePrefix && (docPath === basePrefix || docPath.startsWith(basePrefix + '/'))
    const rebased =
      underPrefix && value.startsWith('/d/') && !value.startsWith(basePrefix + '/') ? basePrefix + value : value
    const url = new URL(rebased, docUrl)
    return /\/assets\//.test(url.pathname) ? url.href : null
  } catch {
    return null
  }
}

function absolutizeAssetAttr(el: Element, attr: 'src' | 'href', docUrl: string, basePrefix = '') {
  const value = el.getAttribute(attr)?.trim()
  if (!value) return
  const resolved = resolveDocAssetUrl(value, docUrl, basePrefix)
  if (resolved) el.setAttribute(attr, resolved)
}

function neutralizeEditableControls(doc: Document) {
  doc.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('contenteditable', 'false'))
  doc.querySelectorAll('input, textarea, select, button').forEach((el) => el.setAttribute('disabled', ''))
}

export function absolutizeDocAssetUrls(html: string, docUrl = resolveAbsoluteOctoDocBase()): string {
  if (typeof DOMParser === 'undefined') return html
  const absoluteDocUrl = resolveAbsoluteUrl(docUrl)
  const base = resolveOctoDocBase()
  const basePrefix = base.startsWith('/') ? base.replace(/\/+$/, '') : ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('img[src]').forEach((el) => absolutizeAssetAttr(el, 'src', absoluteDocUrl, basePrefix))
  doc.querySelectorAll('link[href]').forEach((el) => absolutizeAssetAttr(el, 'href', absoluteDocUrl, basePrefix))
  neutralizeEditableControls(doc)
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : ''
  return `${doctype}${doc.documentElement.outerHTML}`
}

// baseUrl is inserted verbatim: forcing a trailing slash would turn a file-style doc URL
// (…/v/3) into a directory (…/v/3/), shifting relative resolution down one level and breaking
// fragment-vs-document identity. Callers pass the exact desired base.
export function injectBaseHref(html: string, baseUrl: string): string {
  if (!baseUrl) return html
  const baseTag = `<base href="${baseUrl.replace(/"/g, '&quot;')}">`
  const headOpen = /<head[^>]*>/i.exec(html)
  if (!headOpen) return `${baseTag}${html}`
  const at = headOpen.index + headOpen[0].length
  return `${html.slice(0, at)}${baseTag}${html.slice(at)}`
}

function findFragmentTarget(doc: Document, rawFragment: string): Element | null {
  try {
    let id = rawFragment
    try {
      id = decodeURIComponent(rawFragment)
    } catch {
      /* keep raw when it is not valid percent-encoding */
    }
    if (!id) return null
    const byId = doc.getElementById(id)
    if (byId) return byId
    // Name lookup via getElementsByName avoids building a selector string: an id with newline/NULL
    // or other CSS metacharacters would otherwise abort querySelector and (post-preventDefault)
    // strand the click — neither scrolling nor navigating.
    return doc.getElementsByName(id)[0] ?? null
  } catch {
    return null
  }
}

// Effective link target = the element's own target attribute, or (when absent/empty) the target of
// the first <base> that actually carries a target attribute. Per HTML this base may differ from the
// one deciding href, so we scan for a target-bearing base rather than the first base — our injected
// href-only <base> must not shadow the author's <base target>.
// Values are read verbatim: a target is a browsing-context NAME, so trimming would turn a named
// " _self " into the reserved keyword and silently change navigation semantics.
function resolveEffectiveTarget(anchor: Element, doc: Document): string {
  const own = anchor.getAttribute('target')
  if (own) return own
  const bases = doc.getElementsByTagName('base')
  for (let i = 0; i < bases.length; i++) {
    const t = bases[i].getAttribute('target')
    if (t) return t
  }
  return ''
}

/**
 * Parent-side in-page anchor handling for the sandboxed (no-scripts) preview iframe.
 *
 * With a <base>, a bare `#frag` on `about:srcdoc` resolves to an absolute URL that differs from the
 * document's own URL, so the browser treats the click as cross-document navigation and replaces the
 * whole frame. We intercept clicks whose resolved target (minus fragment) is THIS document (or that
 * are plain `#` fragments) and scroll instead — never navigating the frame away.
 *
 * @returns an unbind function; callers MUST invoke it on reload / unmount / slug|version change.
 */
export function bindAnchorNavigation(doc: Document, docUrl: string): () => void {
  const view = doc.defaultView
  const docHref = (() => {
    try {
      return resolveAbsoluteUrl(docUrl)
    } catch {
      return docUrl
    }
  })()
  const docNoFragment = docHref.split('#')[0]

  const onClick = (event: MouseEvent) => {
    // Honour explicit new-tab / modified clicks and anything already handled upstream.
    if (event.defaultPrevented) return
    if (event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const target = event.target as Element | null
    // Also match <area href> (image-map anchors) which closest('a') misses.
    const anchor = target?.closest?.('a[href], area[href]') as
      | HTMLAnchorElement
      | HTMLAreaElement
      | null
    if (!anchor) return
    // Let the browser handle downloads and any effective target (incl. one from <base target>).
    if (anchor.hasAttribute('download')) return
    // target reflects only the element's own attribute; the browser layers <base target> on top of
    // that, so resolve the effective value ourselves before deciding to intercept.
    // Reserved target keywords are ASCII case-insensitive, so `_SELF` must count as self-targeting.
    const effectiveTarget = resolveEffectiveTarget(anchor, doc)
    if (effectiveTarget && effectiveTarget.toLowerCase() !== '_self') return
    const rawHref = anchor.getAttribute('href')
    if (rawHref == null) return

    let fragment: string | null = null
    if (rawHref.startsWith('#')) {
      fragment = rawHref.slice(1)
    } else {
      // Resolve against the document's own URL; only treat as in-page when it targets THIS doc.
      let resolved: URL
      try {
        resolved = new URL(rawHref, docHref)
      } catch {
        return
      }
      if (!resolved.hash) return
      if (`${resolved.origin}${resolved.pathname}${resolved.search}` !== docNoFragment) return
      fragment = resolved.hash.slice(1)
    }
    if (fragment == null) return

    // From here it is an in-page anchor: never let the frame navigate, even on a miss.
    event.preventDefault()
    // Fragment semantics: locate the target first (so id="top" wins); only scroll to the page top
    // when the fragment is empty, or it is `top` with no matching element.
    const el = fragment ? findFragmentTarget(doc, fragment) : null
    if (el) {
      el.scrollIntoView({ block: 'start' })
      return
    }
    if (fragment === '' || fragment === 'top') {
      view?.scrollTo?.(0, 0)
      doc.documentElement?.scrollTo?.(0, 0)
    }
  }

  doc.addEventListener('click', onClick)
  return () => doc.removeEventListener('click', onClick)
}
