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

export function injectBaseHref(html: string, baseUrl: string): string {
  if (!baseUrl) return html
  const href = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const baseTag = `<base href="${href.replace(/"/g, '&quot;')}">`
  const headOpen = /<head[^>]*>/i.exec(html)
  if (!headOpen) return `${baseTag}${html}`
  const at = headOpen.index + headOpen[0].length
  return `${html.slice(0, at)}${baseTag}${html.slice(at)}`
}
