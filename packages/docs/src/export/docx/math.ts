/**
 * LaTeX → OMML conversion for the DOCX export.
 *
 * Word only renders native, editable math from OMML (`<m:oMath>`) markup, so we
 * cannot just drop the LaTeX source into a run (that renders as literal text).
 * The conversion chain is:
 *
 *   LaTeX ──(mathjax-full, TeX input)──▶ MathML
 *         ──(our mathmlToOmml)─────────▶ OMML string
 *         ──(xml-js + docx.convertToXmlComponent)──▶ docx XmlComponent
 *
 * The resulting component can be pushed straight into a Paragraph's children.
 *
 * We convert MathML→OMML ourselves (see ./mathml-to-omml) rather than using the
 * `mathml2omml` package: that package emits large operators (∫ ∑ …) as an
 * `<m:nary>` with an EMPTY `<m:e>` and strands the integrand as sibling runs,
 * which Word renders as an empty little box — the "公式还在小方格里" bug.
 *
 * docx 9.7.1 note: the package's index exports `Math`/`MathRun` builders, but
 * assembling arbitrary formulas from those by hand would require a full LaTeX
 * parser. Instead we inject the raw OMML via the exported `convertToXmlComponent`
 * helper. `ImportedXmlComponent.fromXmlString` is NOT usable directly here: it
 * feeds the whole string through `xml2js` and wraps the document root — whose
 * xml-js node has no tag name — producing a malformed `<undefined>…</undefined>`
 * wrapper around the `<m:oMath>`. So we parse ourselves and hand
 * `convertToXmlComponent` the actual `<m:oMath>` element node.
 *
 * The MathJax pipeline is built lazily once and reused. Any failure anywhere in
 * the chain returns null so callers can fall back to plain source text without
 * crashing the whole export.
 */

import { convertToXmlComponent, type ParagraphChild } from 'docx'
import { xml2js, type Element } from 'xml-js'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { SerializedMmlVisitor } from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js'
import { STATE } from 'mathjax-full/js/core/MathItem.js'
import type { MmlNode } from 'mathjax-full/js/core/MmlTree/MmlNode.js'
// Importing these configuration modules registers the `base` and `ams` TeX
// packages as a side-effect. Without the AMS import, `new TeX({ packages:
// ['base','ams'] })` silently leaves AMS environments unregistered, so every
// matrix/pmatrix/cases/align formula fails with "Unknown environment" and
// degrades to raw LaTeX source text in Word. The import wires up the extension.
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js'
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js'
// Registers the `color` TeX package so `\color{…}` / `\textcolor{…}{…}` compile
// to `<mstyle mathcolor>` instead of failing with "Undefined control sequence"
// and degrading the whole formula to raw LaTeX source text in Word.
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js'
import { mathmlToOmml } from './mathml-to-omml.ts'

/** LaTeX → MathML converter, or null if MathJax failed to initialize. */
type MathMLConverter = (latex: string, display: boolean) => string

// `undefined` = not yet initialized; `null` = init failed (don't retry).
let converter: MathMLConverter | null | undefined

/**
 * Build the MathJax TeX→MathML pipeline once and cache it.
 *
 * We stop conversion at `STATE.COMPILED`: that yields the internal MathML tree
 * (which we serialize) without running a display/output jax — MathJax ships no
 * MathML output jax in this build, and later stages (e.g. the `AllPackages`
 * `bussproofs` extension) demand an output jax with `getBBox()`. Restricting to
 * the `base` + `ams` packages keeps us to macros that compile without one while
 * still covering the vast majority of real-world formulas.
 */
function getConverter(): MathMLConverter | null {
  if (converter !== undefined) return converter
  try {
    const adaptor = liteAdaptor()
    RegisterHTMLHandler(adaptor)
    // `color` covers \color/\textcolor so they compile to `<mstyle mathcolor>`
    // instead of erroring and degrading the whole formula to raw source text.
    const tex = new TeX({ packages: ['base', 'ams', 'color'] })
    const doc = mathjax.document('', { InputJax: tex })
    const visitor = new SerializedMmlVisitor()
    converter = (latex: string, display: boolean): string => {
      const node = doc.convert(latex, { display, end: STATE.COMPILED }) as MmlNode
      return visitor.visitTree(node)
    }
  } catch (err) {
    console.warn('[docx] MathJax pipeline init failed; math falls back to source text', err)
    converter = null
  }
  return converter
}

/**
 * Convert a LaTeX formula into a docx math component ready to be placed in a
 * Paragraph's children.
 *
 * @param latex   the LaTeX source (without surrounding `$`/`$$`)
 * @param display true for block/display math, false for inline
 * @returns the math component, or null if conversion failed (caller should
 *          fall back to rendering the raw source text)
 */
/**
 * Rewrite a few non-standard TeX commands seen in real source data onto their
 * standard equivalents so MathJax compiles them instead of emitting an
 * `<merror>` (which forces the whole formula to degrade to raw LaTeX text in
 * Word). Kept intentionally small and exact so it never mangles valid input.
 *   - `\hdots` is not a real LaTeX command; treat it as `\dots`.
 */
function normalizeSourceLatex(src: string): string {
  if (!src) return src
  // Replace \hdots only when it is a complete command token (followed by a
  // non-letter or end of string), so we never touch a longer macro name.
  return src.replace(/\\hdots(?![a-zA-Z])/g, '\\dots')
}

export function latexToMathComponent(latex: string, display: boolean): ParagraphChild | null {
  const src = normalizeSourceLatex(typeof latex === 'string' ? latex.trim() : '')
  if (!src) return null

  const convert = getConverter()
  if (!convert) return null

  try {
    const mathml = convert(src, display)
    const omml = mathmlToOmml(mathml)

    // Parse the OMML ourselves and hand convertToXmlComponent the actual
    // <m:oMath> element (see the file header for why fromXmlString is unsafe).
    const parsed = xml2js(omml, { compact: false }) as Element
    const root = (parsed.elements ?? []).find(
      (el) => el.type === 'element' && el.name === 'm:oMath',
    )
    if (!root) {
      console.warn(`[docx] LaTeX→OMML produced no <m:oMath> node for: ${src}`)
      return null
    }

    const component = convertToXmlComponent(root)
    if (!component || typeof component === 'string') {
      console.warn(`[docx] LaTeX→OMML yielded a non-element component for: ${src}`)
      return null
    }
    // convertToXmlComponent returns an ImportedXmlComponent, which docx
    // serializes correctly but which is not part of the ParagraphChild union.
    // The cast is the intended escape hatch for injecting raw OOXML.
    return component as unknown as ParagraphChild
  } catch (err) {
    console.warn(`[docx] LaTeX→OMML conversion failed for: ${src}`, err)
    return null
  }
}
