/**
 * KaTeX → positioned glyph extraction for PDF export.
 *
 * Strategy (the crux of "rendered math that is still selectable text"):
 *   1. Render the LaTeX with KaTeX to real DOM (HTML output, not SVG).
 *   2. Let the browser lay it out (KaTeX already computed the 2D positions:
 *      stacked fractions, super/subscripts, big-operator limits, roots).
 *   3. Walk the leaf spans, read each glyph's getBoundingClientRect() plus its
 *      computed font-family/size, and its fraction-bar rules.
 *   4. Emit a flat list of positioned items in a PDF-friendly coordinate space.
 *
 * The caller (renderBlockMath / inline math) draws each glyph with pdf.text at
 * the mapped position using the matching KaTeX font, and each rule with
 * pdf.rect. Result: a normally-rendered formula whose characters are real,
 * selectable, searchable PDF text — no SVG, no image.
 *
 * This requires a DOM with a layout engine, i.e. it only runs in the browser
 * at export time (which is exactly where our export runs). In non-DOM test
 * environments extractMathLayout returns null and the caller falls back.
 */

import katex from 'katex'
// Vite inlines the CSS text (not injected as a <link>) so we can guarantee the
// KaTeX stylesheet is present in the measurement context. WITHOUT this CSS the
// browser lays every glyph on one baseline (the `.vlist` top-offsets that stack
// fractions/limits are pure CSS), so measured coords collapse to a flat row and
// the PDF shows all symbols piled together. Injecting it once fixes layout.
import katexCss from 'katex/dist/katex.min.css?inline'
import { fontAliasFor } from './katex-fonts.ts'

/** Ensure the KaTeX stylesheet is present in <head> exactly once. */
let cssInjected = false
function ensureKatexCss(): void {
  if (cssInjected) return
  if (typeof document === 'undefined' || !document.head) return
  // If the app already loaded katex CSS (editor bundle), a second copy is
  // harmless, but guard by a marker id to avoid piling up on repeated exports.
  if (document.getElementById('katex-pdf-export-css')) {
    cssInjected = true
    return
  }
  const style = document.createElement('style')
  style.id = 'katex-pdf-export-css'
  style.textContent = typeof katexCss === 'string' ? katexCss : ''
  document.head.appendChild(style)
  cssInjected = true
}

/** The KaTeX faces we measure/draw with; used to force-load before measuring. */
const KATEX_FACE_SPECS = [
  '16px "KaTeX_Main"',
  '16px "KaTeX_Math"',
  '16px "KaTeX_Size1"',
  '16px "KaTeX_Size2"',
  '16px "KaTeX_Size3"',
  '16px "KaTeX_Size4"',
  '16px "KaTeX_AMS"',
  '16px "KaTeX_Caligraphic"',
  '16px "KaTeX_Fraktur"',
  '16px "KaTeX_SansSerif"',
  '16px "KaTeX_Script"',
  '16px "KaTeX_Typewriter"',
]

/**
 * Force the browser to load the KaTeX web fonts BEFORE any measurement.
 *
 * Critical: extractMathLayout measures glyph rects synchronously. If the KaTeX
 * fonts (esp. KaTeX_Size2 for big operators like ∑/∫) are not loaded yet, the
 * browser measures a fallback font — a much narrower ∑ (~11px vs the real 28px)
 * — so the measured layout is wrong and the drawn (real-font) ∑ overflows into
 * the following content. Awaiting font readiness makes measurement and drawing
 * see the same fonts. Call once (awaited) before the synchronous render pass.
 */
export async function preloadKatexFonts(): Promise<void> {
  if (typeof document === 'undefined') return
  ensureKatexCss()
  const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts
  if (!fonts) return
  try {
    await Promise.all(
      KATEX_FACE_SPECS.map((spec) => fonts.load(spec).catch(() => undefined)),
    )
    // Belt-and-suspenders: also wait for the global ready signal.
    if (typeof fonts.ready?.then === 'function') {
      await fonts.ready
    }
  } catch {
    // Best-effort; measurement will still work, just possibly with fallback
    // metrics if the environment blocks font loading.
  }
}

/** A single drawable item from a laid-out formula. Coordinates are in CSS px, */
/** relative to the formula's top-left, y growing downward. */
export interface MathItem {
  kind: 'glyph' | 'rule' | 'radical'
  /** Glyph text (kind='glyph'). */
  text?: string
  /** Left edge (px, relative to formula box). */
  x: number
  /** Baseline y for glyphs; top y for rules (px, relative to formula box). */
  y: number
  /** Width (px) — used for rules (fraction bars, sqrt vinculum). */
  width?: number
  /** Height/thickness (px) — used for rules. */
  height?: number
  /** jsPDF font alias (kind='glyph'). */
  font?: string
  /** Font size in px (kind='glyph'). */
  fontSizePx?: number
  /** Radical box (kind='radical'): full sqrt bounding box in px, box-relative. */
  radical?: { x: number; y: number; width: number; height: number }
}

/** The full laid-out formula: items + overall box size (px). */
export interface MathLayout {
  items: MathItem[]
  widthPx: number
  heightPx: number
  /** Distance (px) from the formula box top to the math axis/baseline of the */
  /** outermost row — used to align the formula with surrounding text. */
  baselinePx: number
}

/** True when a real layout-capable DOM is available. */
export function domLayoutAvailable(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof (globalThis as { getComputedStyle?: unknown }).getComputedStyle === 'function' &&
    typeof document.createElement === 'function'
  )
}

/**
 * Render + measure a LaTeX formula. Returns null if a layout DOM is not
 * available or KaTeX fails (caller falls back to raw LaTeX text).
 */
export function extractMathLayout(latex: string, displayMode: boolean): MathLayout | null {
  if (!domLayoutAvailable()) return null

  // The 2D layout (stacked fractions, super/subscripts, big-op limits) is done
  // entirely by KaTeX's CSS. Without it, glyphs collapse onto one baseline.
  ensureKatexCss()

  let host: HTMLElement | null = null
  try {
    host = document.createElement('div')
    // Position off-screen but still laid out. Font-size fixed so px↔em is
    // stable and predictable; caller scales to the target PDF font size.
    host.style.cssText =
      'position:absolute;left:-99999px;top:0;visibility:hidden;' +
      'font-size:16px;line-height:normal;'
    document.body.appendChild(host)

    katex.render(latex, host, {
      throwOnError: false,
      displayMode,
      output: 'html',
    })

    const root = host.querySelector('.katex-html') as HTMLElement | null
    if (!root) return null

    const box = root.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) return null

    const items: MathItem[] = []
    walk(root, box, items)

    // Baseline: KaTeX's outermost `.base` strut defines vertical-align; we take
    // the max glyph baseline of the first base row as the alignment baseline.
    const baselinePx = computeBaseline(root, box)

    return {
      items,
      widthPx: box.width,
      heightPx: box.height,
      baselinePx,
    }
  } catch {
    return null
  } finally {
    if (host && host.parentNode) host.parentNode.removeChild(host)
  }
}

/** Recursively collect glyph + rule items from KaTeX DOM leaves. */
function walk(el: Element, box: DOMRect, out: MathItem[]): void {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? '').replace(/[\u200b\u00a0]/g, '').trim()
      if (!text) continue
      // Wrap the text node's own rect via a Range for accurate metrics.
      const range = document.createRange()
      range.selectNodeContents(child)
      const r = range.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      const parent = child.parentElement
      const cs = parent ? getComputedStyle(parent) : null
      const fontSizePx = cs ? parseFloat(cs.fontSize) || 16 : 16
      const font = cs
        ? fontAliasFor(cs.fontFamily, cs.fontWeight, cs.fontStyle)
        : 'KaTeX_Main'
      out.push({
        kind: 'glyph',
        text,
        x: r.left - box.left,
        // Anchor glyphs by their TOP edge (not baseline). Adjacent glyphs on the
        // same math baseline have DIFFERENT rect.bottom values (each includes
        // that glyph's own descent/height), so using rect.bottom as the baseline
        // misaligns them and the formula looks jumbled. rect.top is exactly what
        // the browser laid out; drawing each glyph with jsPDF baseline:'top' at
        // this y reproduces the browser layout faithfully (same TTF, same size).
        y: r.top - box.top,
        font,
        fontSizePx,
      })
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const ce = child as HTMLElement

    // Fraction bars and over/underline rules are bordered spans, not text.
    if (ce.classList.contains('frac-line') || ce.classList.contains('overline-line') || ce.classList.contains('underline-line')) {
      const r = ce.getBoundingClientRect()
      out.push({
        kind: 'rule',
        x: r.left - box.left,
        y: r.top - box.top,
        width: r.width,
        height: Math.max(r.height, 0.6),
      })
      continue
    }

    // The radical sign (√) is drawn by KaTeX as an inline SVG inside
    // `.svg-align`/`.hide-tail`, which we can't (and won't) rasterize. Instead
    // synthesize it from real text + a rule: draw a √ glyph on the left and a
    // horizontal vinculum along the top of the radicand. Then recurse to pick
    // up the radicand's own glyphs, skipping the SVG subtree.
    if (ce.classList.contains('sqrt')) {
      emitSqrt(ce, box, out)
      continue
    }
    // Never descend into the raw SVG radical itself (the sign), but DO descend
    // into .svg-align generally because KaTeX nests the radicand inside it.
    if (ce.classList.contains('hide-tail')) {
      continue
    }
    // Everything else: recurse (glyphs are text nodes inside).
    walk(ce, box, out)
  }
}

/**
 * Synthesize a radical (√ + vinculum) from text + rule for one `.sqrt` element.
 * KaTeX renders the sign as SVG; we approximate with a √ glyph sized to the
 * radical box plus a horizontal bar over the radicand.
 */
function emitSqrt(sqrtEl: HTMLElement, box: DOMRect, out: MathItem[]): void {
  const sr = sqrtEl.getBoundingClientRect()
  // Emit a single radical item spanning the sqrt box; katex-draw strokes a
  // connected √ (hook + stem + vinculum) as vector lines — the same category
  // as a fraction bar, not an image. This looks authentic and stretches to any
  // radicand width, unlike a fixed √ text glyph with a detached bar.
  out.push({
    kind: 'radical',
    x: sr.left - box.left,
    y: sr.top - box.top,
    radical: {
      x: sr.left - box.left,
      y: sr.top - box.top,
      width: sr.width,
      height: sr.height,
    },
  })
  // Recurse into the radicand. KaTeX nests the radicand INSIDE `.svg-align`
  // alongside the SVG sign, so we descend into svg-align but skip the SVG
  // (.hide-tail) element itself.
  const descend = (node: Node): void => {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType !== Node.ELEMENT_NODE) continue
      const el = c as HTMLElement
      if (el.classList.contains('hide-tail')) continue
      walk(el, box, out)
    }
  }
  descend(sqrtEl)
}

/** Estimate the formula's alignment baseline (px from box top). */
function computeBaseline(root: Element, box: DOMRect): number {
  // Use the tallest first-row glyph's baseline as a proxy. Fall back to the
  // vertical center of the box.
  const firstBase = root.querySelector('.base')
  if (firstBase) {
    const strut = firstBase.querySelector('.strut') as HTMLElement | null
    if (strut) {
      const r = strut.getBoundingClientRect()
      // strut bottom sits on the baseline.
      if (r.height > 0) return r.bottom - box.top
    }
  }
  return box.height / 2
}
