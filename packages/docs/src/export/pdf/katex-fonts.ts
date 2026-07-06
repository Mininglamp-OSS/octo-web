/**
 * KaTeX font registration for PDF export.
 *
 * To render math as *real selectable text* (not SVG/image) we draw each glyph
 * that KaTeX lays out, using the very same KaTeX TTF fonts the browser used for
 * on-screen layout. This keeps glyph metrics consistent between the measured
 * DOM positions and the drawn PDF glyphs.
 *
 * Fonts are imported via Vite's `?url` so the bundler emits the correct hashed
 * asset URLs; we fetch each once, cache the base64, and register it with jsPDF.
 *
 * IMPORTANT: KaTeX ships `.ttf` (and woff/woff2). jsPDF only understands TTF
 * outlines, so we deliberately use the `.ttf` files — the `.otf`-style math
 * fonts (STIX/Latin Modern) silently render as garbage in jsPDF.
 */

import type { jsPDF } from 'jspdf'

// Bundler-resolved URLs for the KaTeX TTF fonts we actually need. KaTeX ships
// ~20 faces; these cover the vast majority of real-world formulas. Anything
// mapped to a face we didn't register falls back to KaTeX_Main-Regular.
import mainRegular from 'katex/dist/fonts/KaTeX_Main-Regular.ttf?url'
import mainBold from 'katex/dist/fonts/KaTeX_Main-Bold.ttf?url'
import mainItalic from 'katex/dist/fonts/KaTeX_Main-Italic.ttf?url'
import mainBoldItalic from 'katex/dist/fonts/KaTeX_Main-BoldItalic.ttf?url'
import mathItalic from 'katex/dist/fonts/KaTeX_Math-Italic.ttf?url'
import mathBoldItalic from 'katex/dist/fonts/KaTeX_Math-BoldItalic.ttf?url'
import ams from 'katex/dist/fonts/KaTeX_AMS-Regular.ttf?url'
import size1 from 'katex/dist/fonts/KaTeX_Size1-Regular.ttf?url'
import size2 from 'katex/dist/fonts/KaTeX_Size2-Regular.ttf?url'
import size3 from 'katex/dist/fonts/KaTeX_Size3-Regular.ttf?url'
import size4 from 'katex/dist/fonts/KaTeX_Size4-Regular.ttf?url'
import caligraphic from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.ttf?url'
import script from 'katex/dist/fonts/KaTeX_Script-Regular.ttf?url'
import fraktur from 'katex/dist/fonts/KaTeX_Fraktur-Regular.ttf?url'
import sansSerif from 'katex/dist/fonts/KaTeX_SansSerif-Regular.ttf?url'
import typewriter from 'katex/dist/fonts/KaTeX_Typewriter-Regular.ttf?url'

/** A registered KaTeX face: the jsPDF alias + the URL to fetch its TTF from. */
interface KatexFace {
  /** jsPDF font alias (what we pass to pdf.setFont). */
  alias: string
  /** Bundler-resolved TTF URL. */
  url: string
  /** VFS filename. */
  vfs: string
}

/**
 * The faces we register. `alias` values are matched against the browser's
 * resolved `font-family` string (see fontAliasFor) so we can pick the right
 * face per glyph.
 */
const FACES: KatexFace[] = [
  { alias: 'KaTeX_Main', url: mainRegular, vfs: 'KaTeX_Main-Regular.ttf' },
  { alias: 'KaTeX_Main-Bold', url: mainBold, vfs: 'KaTeX_Main-Bold.ttf' },
  { alias: 'KaTeX_Main-Italic', url: mainItalic, vfs: 'KaTeX_Main-Italic.ttf' },
  { alias: 'KaTeX_Main-BoldItalic', url: mainBoldItalic, vfs: 'KaTeX_Main-BoldItalic.ttf' },
  { alias: 'KaTeX_Math', url: mathItalic, vfs: 'KaTeX_Math-Italic.ttf' },
  { alias: 'KaTeX_Math-BoldItalic', url: mathBoldItalic, vfs: 'KaTeX_Math-BoldItalic.ttf' },
  { alias: 'KaTeX_AMS', url: ams, vfs: 'KaTeX_AMS-Regular.ttf' },
  { alias: 'KaTeX_Size1', url: size1, vfs: 'KaTeX_Size1-Regular.ttf' },
  { alias: 'KaTeX_Size2', url: size2, vfs: 'KaTeX_Size2-Regular.ttf' },
  { alias: 'KaTeX_Size3', url: size3, vfs: 'KaTeX_Size3-Regular.ttf' },
  { alias: 'KaTeX_Size4', url: size4, vfs: 'KaTeX_Size4-Regular.ttf' },
  { alias: 'KaTeX_Caligraphic', url: caligraphic, vfs: 'KaTeX_Caligraphic-Regular.ttf' },
  { alias: 'KaTeX_Script', url: script, vfs: 'KaTeX_Script-Regular.ttf' },
  { alias: 'KaTeX_Fraktur', url: fraktur, vfs: 'KaTeX_Fraktur-Regular.ttf' },
  { alias: 'KaTeX_SansSerif', url: sansSerif, vfs: 'KaTeX_SansSerif-Regular.ttf' },
  { alias: 'KaTeX_Typewriter', url: typewriter, vfs: 'KaTeX_Typewriter-Regular.ttf' },
]

/** base64 cache keyed by vfs filename. false = fetch failed. */
const cache = new Map<string, string | false>()
/** true once fonts are registered on a given pdf instance (WeakSet). */
const registered = new WeakSet<jsPDF>()
let loadPromise: Promise<boolean> | null = null

async function fetchAsBase64(url: string): Promise<string | false> {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(t)
    if (!res.ok) return false
    const bytes = new Uint8Array(await res.arrayBuffer())
    let binary = ''
    const chunk = 8192
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    return btoa(binary)
  } catch {
    return false
  }
}

/**
 * Fetch + register all KaTeX faces on the given jsPDF instance. Idempotent per
 * instance. Returns true if at least KaTeX_Main registered (enough to render).
 */
export async function registerKatexFonts(pdf: jsPDF): Promise<boolean> {
  if (registered.has(pdf)) return true

  // Load base64 for every face once (shared across pdf instances / exports).
  if (!loadPromise) {
    loadPromise = (async () => {
      await Promise.all(
        FACES.map(async (f) => {
          if (cache.has(f.vfs)) return
          cache.set(f.vfs, await fetchAsBase64(f.url))
        }),
      )
      return cache.get('KaTeX_Main-Regular.ttf') ? true : false
    })()
  }
  const ok = await loadPromise
  if (!ok) return false

  try {
    for (const f of FACES) {
      const data = cache.get(f.vfs)
      if (!data) continue
      pdf.addFileToVFS(f.vfs, data)
      pdf.addFont(f.vfs, f.alias, 'normal')
    }
    registered.add(pdf)
    return true
  } catch (err) {
    console.warn('[pdf-export] Failed to register KaTeX fonts:', err)
    return false
  }
}

/**
 * Map a browser-resolved `font-family` string (from getComputedStyle) to one of
 * our registered jsPDF aliases. KaTeX sets families like "KaTeX_Math",
 * "KaTeX_Main", optionally with bold/italic via font-weight/style, but for our
 * registered faces we encode weight/style into the alias name.
 *
 * @param family  computed fontFamily (may be a comma list / quoted)
 * @param weight  computed fontWeight ('400'|'700'|'bold'|number)
 * @param style   computed fontStyle ('normal'|'italic')
 */
export function fontAliasFor(family: string, weight: string, style: string): string {
  const fam = (family || '').replace(/["']/g, '')
  const first = fam.split(',')[0].trim()
  const bold = weight === 'bold' || Number(weight) >= 600
  const italic = style === 'italic'

  // Normalize the base family to one of our registered roots.
  let root = 'KaTeX_Main'
  if (first.startsWith('KaTeX_Math')) root = 'KaTeX_Math'
  else if (first.startsWith('KaTeX_AMS')) return 'KaTeX_AMS'
  else if (first.startsWith('KaTeX_Size1')) return 'KaTeX_Size1'
  else if (first.startsWith('KaTeX_Size2')) return 'KaTeX_Size2'
  else if (first.startsWith('KaTeX_Size3')) return 'KaTeX_Size3'
  else if (first.startsWith('KaTeX_Size4')) return 'KaTeX_Size4'
  else if (first.startsWith('KaTeX_Caligraphic')) return 'KaTeX_Caligraphic'
  else if (first.startsWith('KaTeX_Script')) return 'KaTeX_Script'
  else if (first.startsWith('KaTeX_Fraktur')) return 'KaTeX_Fraktur'
  else if (first.startsWith('KaTeX_SansSerif')) return 'KaTeX_SansSerif'
  else if (first.startsWith('KaTeX_Typewriter')) return 'KaTeX_Typewriter'
  else if (first.startsWith('KaTeX_Main')) root = 'KaTeX_Main'

  if (root === 'KaTeX_Math') {
    return bold && italic ? 'KaTeX_Math-BoldItalic' : 'KaTeX_Math'
  }
  // KaTeX_Main variants.
  if (bold && italic) return 'KaTeX_Main-BoldItalic'
  if (bold) return 'KaTeX_Main-Bold'
  if (italic) return 'KaTeX_Main-Italic'
  return 'KaTeX_Main'
}

/** Reset caches (tests only). */
export function __resetKatexFontCache(): void {
  cache.clear()
  loadPromise = null
}
