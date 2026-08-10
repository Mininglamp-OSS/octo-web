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

// srcDoc documents live at about:srcdoc. Address of the rendered doc — an in-page fragment must be
// spelled against THIS, not the <base>.
export const SRCDOC_URL = 'about:srcdoc'

// A bare `#frag` is resolved against the <base> we inject, producing an http URL that differs from
// about:srcdoc — the browser then treats the click as cross-document and replaces the whole frame.
// Re-spelling it as `about:srcdoc#frag` restores same-document identity, so the browser scrolls
// natively. The <base> stays untouched, so every asset (CSS url(), srcset, <source>, svg) keeps
// resolving exactly as before.
function rewriteInPageFragmentHrefs(doc: Document, absoluteDocUrl: string) {
  // An effective target (own attr, or inherited from any <base target>) means the author wants a
  // different browsing context; leave those to the browser.
  const baseTarget = Array.from(doc.getElementsByTagName('base')).some((b) => !!b.getAttribute('target'))
  const docNoFragment = (() => {
    try {
      const u = new URL(absoluteDocUrl)
      return `${u.origin}${u.pathname}${u.search}`
    } catch {
      return null
    }
  })()
  doc.querySelectorAll('a[href], area[href]').forEach((el) => {
    const href = el.getAttribute('href')
    if (href == null) return
    if (baseTarget || el.getAttribute('target')) return
    if (href.startsWith('#')) {
      el.setAttribute('href', `${SRCDOC_URL}${href}`)
      return
    }
    // A fully-qualified self-link (…/d/{slug}/v/{ver}#frag) is the same document too. Relative
    // hrefs are NOT touched: the browser resolves them against the injected <base>, which is not
    // this docUrl, so we cannot decide same-document identity for them here.
    if (!docNoFragment || !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) return
    let resolved: URL
    try {
      resolved = new URL(href)
    } catch {
      return
    }
    if (!resolved.hash) return
    if (`${resolved.origin}${resolved.pathname}${resolved.search}` !== docNoFragment) return
    el.setAttribute('href', `${SRCDOC_URL}${resolved.hash}`)
  })
}

export function absolutizeDocAssetUrls(html: string, docUrl = resolveAbsoluteOctoDocBase()): string {
  if (typeof DOMParser === 'undefined') return html
  const absoluteDocUrl = resolveAbsoluteUrl(docUrl)
  const base = resolveOctoDocBase()
  const basePrefix = base.startsWith('/') ? base.replace(/\/+$/, '') : ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('img[src]').forEach((el) => absolutizeAssetAttr(el, 'src', absoluteDocUrl, basePrefix))
  doc.querySelectorAll('link[href]').forEach((el) => absolutizeAssetAttr(el, 'href', absoluteDocUrl, basePrefix))
  rewriteInPageFragmentHrefs(doc, absoluteDocUrl)
  neutralizeEditableControls(doc)
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>` : ''
  return `${doctype}${doc.documentElement.outerHTML}`
}

export function injectBaseHref(html: string, baseUrl: string): string {
  if (!baseUrl) return html
  const href = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const baseTag = `<base href="${href.replace(/"/g, '&quot;')}">`
  const headOpen = /<head[^>]*>/i.exec(html)
  if (!headOpen) return `${baseTag}${html}`
  const at = headOpen.index + headOpen[0].length
  return `${html.slice(0, at)}${baseTag}${html.slice(at)}`
}
