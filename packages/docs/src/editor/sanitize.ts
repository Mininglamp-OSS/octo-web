// URL sanitization (frontend-design §3.7).
//
// Cleaning is layered by purpose, not just by scheme:
//   - links: scheme whitelist http/https/mailto.
//   - images/attachments: scheme whitelist http/https (NO mailto) AND host must be in the
//     Octo object-storage whitelist (rejects arbitrary external hotlinking).
// Both must run at attrs-parse time and at render time; a miss in either is bypassable.

import { ASSET_HOST_WHITELIST } from '../config.ts'

const LINK_SCHEME_WHITELIST = new Set(['http:', 'https:', 'mailto:'])
const ASSET_SCHEME_WHITELIST = new Set(['http:', 'https:']) // assets must not be mailto
// Bookmarks (SCHEMA_VERSION 15): only navigable web URLs become link-preview cards —
// http/https ONLY (no mailto: an email is not a web page), and NO storage-host
// restriction (the bookmarked page + its og:image live on arbitrary external hosts).
const BOOKMARK_SCHEME_WHITELIST = new Set(['http:', 'https:'])

const ORIGIN = (): string =>
  typeof window !== 'undefined' && window.location ? window.location.origin : 'https://octo.local'

/** Link href: scheme whitelist only (incl. mailto). Protocol-relative / pseudo schemes rejected. */
export function sanitizeLinkHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw, ORIGIN()) // resolve relative / protocol-relative against current origin
    return LINK_SCHEME_WHITELIST.has(u.protocol) ? u.href : null
  } catch {
    return null
  }
}

/** Image/attachment URL: scheme whitelist (no mailto) + host must be in the storage whitelist. */
export function sanitizeAssetUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw, ORIGIN())
    if (!ASSET_SCHEME_WHITELIST.has(u.protocol)) return null
    if (!ASSET_HOST_WHITELIST.has(u.host)) return null // reject arbitrary external hotlink
    return u.href
  } catch {
    return null
  }
}

/**
 * Bookmark URL / og:image URL: scheme whitelist (http/https only — NO mailto, NO
 * pseudo-protocols), but unlike assets there is NO host whitelist (the bookmarked page
 * and its thumbnail are external by definition). Runs at attrs-parse AND render time so
 * a `javascript:`/`data:` URL can never enter the Y.Doc or be serialized back out.
 */
export function sanitizeBookmarkUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw, ORIGIN())
    return BOOKMARK_SCHEME_WHITELIST.has(u.protocol) ? u.href : null
  } catch {
    return null
  }
}

/** srcset: filter each candidate URL through sanitizeAssetUrl; drop the invalid ones. */
export function sanitizeSrcset(raw: string | null | undefined): string | null {
  if (!raw) return null
  const safe = raw
    .split(',')
    .map((part) => part.trim())
    .map((part) => {
      const [url, descriptor] = part.split(/\s+/, 2)
      const clean = sanitizeAssetUrl(url)
      return clean ? [clean, descriptor].filter(Boolean).join(' ') : null
    })
    .filter((x): x is string => Boolean(x))
  return safe.length ? safe.join(', ') : null
}

/** Render-time link attrs: whitelist + rel to defend against window.opener. */
export function renderLinkAttrs(href: string): { href: string | null; rel?: string } {
  const safe = sanitizeLinkHref(href)
  return safe ? { href: safe, rel: 'noopener noreferrer' } : { href: null }
}

/**
 * Strip inline `font-family` declarations from pasted HTML.
 *
 * Gates the paste WRITE path while FONT_FAMILY_ENABLED is off (config.ts): the flag
 * exists so fontFamily stays unwritable until every client bundle carries the attr
 * (version convergence). The toolbar selector is the first write path and is already
 * flag-gated (Toolbar.tsx); paste is the second — a `<span style="font-family:…">`
 * copied from Word/browser would otherwise be parsed by the (unconditionally
 * registered) FontFamily extension and land in the shared Y.Doc, so an older client
 * whose schema lacks the attr would silently strip it → data loss.
 *
 * This removes ONLY the inline `font-family` style — exactly what FontFamily.parseHTML
 * reads (`element.style.fontFamily`) — leaving all other markup, styles, and text
 * intact. It touches the paste path ONLY: parsing/rendering already-stored fonts
 * (round-trip, opening old docs) is unaffected, so the flag stays a write gate, not a
 * read gate. When the flag is on, callers skip this and pasted fonts are preserved.
 */
export function stripPastedFontFamily(html: string): string {
  if (typeof document === 'undefined' || !/font-family/i.test(html)) return html
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    parsed.querySelectorAll('[style]').forEach((el) => {
      const style = el.getAttribute('style') ?? ''
      // Rebuild the inline style without any `font-family` declaration. Work on the raw
      // attribute string (not the CSSOM) so an upper/mixed-case `FONT-FAMILY` — which a
      // browser normalizes and reads, but jsdom's CSSOM does not — is stripped too.
      const kept = style
        .split(';')
        .filter((decl) => decl.trim() && decl.split(':', 1)[0].trim().toLowerCase() !== 'font-family')
        .map((decl) => decl.trim())
        .join('; ')
      if (kept) el.setAttribute('style', kept)
      else el.removeAttribute('style')
    })
    return parsed.body.innerHTML
  } catch {
    return html
  }
}
