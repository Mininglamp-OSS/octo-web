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
 * This removes the inline font-family that FontFamily.parseHTML reads
 * (`element.style.fontFamily`) via BOTH inline paths that populate it:
 *   1. the `font-family` longhand (`font-family: Georgia`), and
 *   2. the `font` shorthand (`font: 14px Georgia`), whose family component the browser
 *      (and jsdom's CSSOM) expands into `element.style.fontFamily` just the same.
 * The shorthand path was the RC miss: stripping only the longhand let a
 * `<span style="font: 14px Georgia">` copied from Word/browser still write fontFamily
 * into the Y.Doc while the flag was off.
 *
 * All other markup, styles, and text stay intact. It touches the paste path ONLY:
 * parsing/rendering already-stored fonts (round-trip, opening old docs) is unaffected,
 * so the flag stays a write gate, not a read gate. When the flag is on, callers skip
 * this and pasted fonts are preserved.
 */
export function stripPastedFontFamily(html: string): string {
  // Guard matches both `font-family:` and the `font:` shorthand (any case), but not
  // sibling longhands like `font-size:`/`font-weight:` or the plain word "font" in text.
  if (typeof document === 'undefined' || !/font(-family)?\s*:/i.test(html)) return html
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    parsed.querySelectorAll('[style]').forEach((el) => {
      const style = el.getAttribute('style') ?? ''
      // Rebuild the inline style declaration-by-declaration, dropping every font-family
      // source. Work on the raw attribute string (not the CSSOM) so an upper/mixed-case
      // `FONT-FAMILY` / `FONT` — which a browser normalizes and reads, but jsdom's CSSOM
      // does not surface when reading a specific longhand — is handled too.
      const kept = style
        .split(';')
        .map((decl) => decl.trim())
        .filter(Boolean)
        .map((decl) => {
          const colon = decl.indexOf(':')
          if (colon === -1) return decl // malformed fragment: leave as-is (carries no family)
          const prop = decl.slice(0, colon).trim().toLowerCase()
          if (prop === 'font-family') return null // longhand: drop the whole declaration
          if (prop === 'font') return keptFromFontShorthand(decl.slice(colon + 1)) // shorthand
          return decl
        })
        .filter((decl): decl is string => Boolean(decl))
        .join('; ')
      if (kept) el.setAttribute('style', kept)
      else el.removeAttribute('style')
    })
    return parsed.body.innerHTML
  } catch {
    return html
  }
}

// CSS `font` shorthand components that are safe to keep because they never carry a
// font-family: only the size and the (slash-prefixed) line-height. Size keywords per
// the <font-size> grammar; anything with a unit or `%` is a length/percentage size.
const FONT_SIZE_KEYWORD = /^(xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i
const FONT_SIZE_LENGTH = /^[+-]?(\d+\.?\d*|\.\d+)(px|pt|pc|em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|cm|mm|in|q|%)$/i
// `font: caption|icon|…` sets a *system* font — no explicit family text and no reusable
// size — so it is dropped wholesale.
const SYSTEM_FONT_KEYWORDS = new Set(['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar'])

/**
 * Rebuild a `font` shorthand value with its font-family removed, preserving font-size
 * and line-height. In the shorthand grammar the font-family always trails the required
 * `<font-size> [ / <line-height> ]?`, so we scan left-to-right for the first size token
 * (a size keyword, length, or percentage — unitless weights like `400` are skipped),
 * keep it plus any `/line-height`, and drop everything else (the family, and also
 * style/variant/weight/stretch — an acceptable conservative loss for a paste gate that
 * is off by default). Returns null to drop the declaration entirely when no font-size
 * can be identified (e.g. a system-font keyword or an unparseable value), which keeps
 * the gate safe: family text is never re-emitted.
 */
function keptFromFontShorthand(value: string): string | null {
  const v = value.trim()
  if (!v || SYSTEM_FONT_KEYWORDS.has(v.toLowerCase())) return null
  // Normalize `12px/1.5` → `12px / 1.5` so the line-height slash is its own token.
  const tokens = v.replace(/\//g, ' / ').split(/\s+/).filter(Boolean)
  let fontSize: string | null = null
  let lineHeight: string | null = null
  for (let i = 0; i < tokens.length; i++) {
    if (FONT_SIZE_KEYWORD.test(tokens[i]) || FONT_SIZE_LENGTH.test(tokens[i])) {
      fontSize = tokens[i]
      if (tokens[i + 1] === '/' && tokens[i + 2]) lineHeight = tokens[i + 2]
      break
    }
  }
  if (!fontSize) return null
  const out = [`font-size: ${fontSize}`]
  if (lineHeight) out.push(`line-height: ${lineHeight}`)
  return out.join('; ')
}
