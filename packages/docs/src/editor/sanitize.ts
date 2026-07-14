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
 * The shorthand path was one RC miss; keying the strip on a raw property-NAME byte compare
 * was the deeper one. That compare is defeated by any writing the CSSOM normalizes away but
 * the raw bytes differ on — a CSS comment in the name (`font-family/**​/:`, `/**​/font-family:`),
 * a CSS escape (`font\-family:`, `\66 ont-family:`), or odd casing/whitespace — while the
 * browser still resolves the family and leaks it into the Y.Doc with the flag off. The strip
 * now decides on the RESOLVED property (a modelled name normalization plus the real CSSOM),
 * not the raw name, so every CSSOM-equivalent variant is covered by construction. It is
 * paired with a flag-off `parseHTML` backstop in LiveFontFamily (extensions.ts) that nulls
 * any browser-resolved family regardless — the last line if a novel encoding still slips by.
 *
 * All other markup, styles, and text stay intact. It touches the paste path ONLY:
 * parsing/rendering already-stored fonts (round-trip, opening old docs) is unaffected,
 * so the flag stays a write gate, not a read gate. When the flag is on, callers skip
 * this and pasted fonts are preserved.
 */
export function stripPastedFontFamily(html: string): string {
  // Only skip when there is no DOM to parse (SSR). We must NOT gate on a raw-HTML regex
  // fast-path: the parser entity-decodes the clipboard string, so `font-family&#58;Georgia`
  // (entity colon — likewise `&#x3a;`, `font&#45;family`, `f&#111;nt-family`) carries no
  // literal `font-family:` in the raw string and would slip past such a guard, yet
  // `element.style.fontFamily` still resolves to the family and leaks into the shared Y.Doc
  // with the flag off. The per-element walk below reads `getAttribute('style')`, which the
  // parser has already fully entity-decoded, so running it unconditionally is entity-safe.
  if (typeof document === 'undefined') return html
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    // One reusable probe element for the CSSOM-resolved signal (see declSetsFontFamily).
    const probe = document.createElement('span')
    parsed.querySelectorAll('[style]').forEach((el) => {
      const style = el.getAttribute('style') ?? ''
      // Rebuild the inline style declaration-by-declaration, dropping every font-family
      // source. The decision is made on the *resolved* property, never on a raw byte
      // compare of the attribute name — that byte compare was the whole bug class here,
      // defeated in turn by an entity-colon, a CSS comment, a CSS escape, or odd casing,
      // while the browser's CSSOM resolved the family all the same. We combine two
      // resolved signals and drop if EITHER fires:
      //   (A) normalizeCssPropName() — models how the CSS parser reads a property NAME
      //       (strip comments, decode identifier escapes, drop whitespace, lowercase), so
      //       `font-family/**​/`, `/**​/font-family`, `font\-family`, and `FONT-FAMILY` all
      //       resolve to `font-family`. This is the signal jsdom can evaluate for casing
      //       and escapes, which its CSSOM does not surface.
      //   (B) declSetsFontFamily() — feeds the declaration through the real CSSOM and asks
      //       whether font-family ended up set. This is the browser's own answer, covering
      //       any encoding the name normalizer above did not model.
      // Erring toward removal is safe for a paste gate; the LiveFontFamily parseHTML
      // backstop (flag-off → null) is the final guarantee for anything that still slips by.
      const kept = style
        .split(';')
        .map((decl) => decl.trim())
        .filter(Boolean)
        .map((decl) => {
          const colon = decl.indexOf(':')
          if (colon === -1) return decl // malformed fragment: leave as-is (carries no family)
          const value = decl.slice(colon + 1)
          const name = normalizeCssPropName(decl.slice(0, colon)) // signal A
          if (name === 'font-family') return null // longhand: drop the whole declaration
          if (name === 'font') return keptFromFontShorthand(value) // shorthand: keep size only
          // signal B — the CSSOM resolved this declaration to a font-family despite a name
          // the normalizer above did not classify (a browser-only escape/encoding). Treat a
          // co-resolved font-size as a `font` shorthand so its size survives.
          const resolved = declSetsFontFamily(probe, decl)
          if (resolved.family) return resolved.size ? keptFromFontShorthand(value) : null
          return decl // carries no family by either signal → keep verbatim
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

/**
 * Normalize a raw CSS property NAME the way the CSS parser reads it before matching it to
 * a known property: strip comments, decode identifier escapes, drop whitespace, lowercase.
 * This makes the gate key on the RESOLVED property rather than a raw byte compare that each
 * of `font-family/**​/`, `/**​/font-family`, `font\-family`, `\66 ont-family`, and
 * `FONT-FAMILY` defeats while the browser resolves them all to `font-family`. It is a
 * principled model of name resolution, not a per-variant special case. Input is capped
 * because a real property name is a handful of chars; a longer string is not one.
 */
function normalizeCssPropName(rawName: string): string {
  const capped = rawName.length > 256 ? rawName.slice(0, 256) : rawName
  return capped
    .replace(/\/\*[\s\S]*?\*\//g, '') // CSS comments act as token separators → remove
    .replace(/\\([0-9a-fA-F]{1,6})\s?|\\([\s\S])/g, (_m, hex: string, lit: string) => {
      if (lit !== undefined) return lit // `\-`, `\.`… → the literal char
      const cp = parseInt(hex, 16) // `\66 ` → 'f'
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�'
    })
    .replace(/\s+/g, '') // a property name has no internal/surrounding whitespace
    .toLowerCase()
}

/**
 * Ask the real CSSOM whether a single declaration ends up setting font-family (and whether
 * it also set a font-size, which marks a `font` shorthand). This is the browser's own parse
 * — it strips comments, decodes escapes, and expands the `font` shorthand exactly as the
 * downstream `element.style.fontFamily` read (FontFamily.parseHTML) would — so a family this
 * returns true for is precisely one that would otherwise leak. Declarations already routed
 * by name never reach here, so this adds no new work to the ReDoS-sensitive `font` path.
 */
function declSetsFontFamily(probe: HTMLElement, decl: string): { family: boolean; size: boolean } {
  try {
    probe.style.cssText = '' // clear any residue from the previous declaration
    probe.style.cssText = decl
    return {
      family: (probe.style.fontFamily ?? '').trim() !== '',
      size: (probe.style.fontSize ?? '').trim() !== '',
    }
  } catch {
    return { family: false, size: false }
  }
}

// CSS `font` shorthand components that are safe to keep because they never carry a
// font-family: only the size and the (slash-prefixed) line-height. Size keywords per
// the <font-size> grammar; anything with a unit or `%` is a length/percentage size.
const FONT_SIZE_KEYWORD = /^(xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)$/i
// The number sub-pattern is written unambiguously — `\d+(?:\.\d+)?|\.\d+`, NOT the
// `\d+\.?\d*` form. The latter lets `\d+` and `\d*` both consume the same digit run, so a
// long all-digit token followed by a failing unit forces O(n²) backtracking (a pasted
// `font: 111…111zz` freezes the main thread for seconds — reachable on the default flag-off
// paste path). The unambiguous form has a single parse and is linear.
const FONT_SIZE_LENGTH = /^[+-]?(\d+(?:\.\d+)?|\.\d+)(px|pt|pc|em|rem|ex|ch|cap|ic|lh|rlh|vw|vh|vi|vb|vmin|vmax|cm|mm|in|q|%)$/i
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
    // A real font-size token is a handful of chars; cap length before the regex so no
    // pathological token can ever drive super-linear matching (defense-in-depth alongside
    // the unambiguous FONT_SIZE_LENGTH pattern).
    if (tokens[i].length > 32) continue
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
