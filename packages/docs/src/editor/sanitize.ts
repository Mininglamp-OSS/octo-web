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
