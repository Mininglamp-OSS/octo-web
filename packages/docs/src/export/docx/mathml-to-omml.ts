/**
 * MathML → OMML converter for the DOCX export.
 *
 * This replaces the `mathml2omml` npm package, which mistranslates large
 * operators (∫ ∑ ∏ …): it emits an `<m:nary>` whose `<m:e>` operand body is
 * EMPTY and leaves the integrand/summand stranded as sibling runs after the
 * nary. Word then renders the operator as an empty little box with the body
 * floating beside it — the long-standing "公式还在小方格里" bug.
 *
 * We walk the (correct) MathML tree MathJax produces and emit OMML ourselves,
 * covering the structures real documents use: mi/mn/mo/mtext, msup/msub/
 * msubsup, munder/mover/munderover, mfrac, msqrt/mroot, and large operators as
 * proper `<m:nary>` with a non-empty `<m:e>`.
 *
 * The nary-body problem is genuinely ambiguous in *presentation* MathML: the
 * operator and its integrand are siblings, with no markup delimiting where the
 * integrand ends. We use the reading a human would: the body runs from just
 * after the operator up to (but not including) the next relation operator
 * (=, ≠, <, >, ≤, ≥, →, …) at the same level. So in
 *   ∫_{-∞}^{∞} e^{-x²} dx = √π
 * the body is `e^{-x²} dx` and `= √π` stays outside — exactly right.
 *
 * Any element we don't recognize throws, so the caller can fall back to
 * rendering the raw LaTeX source instead of producing a broken formula.
 */

import { xml2js, type Element } from 'xml-js'

const MATH_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

/**
 * n-ary (large) operators that must become an OMML `<m:nary>` whose `<m:e>`
 * holds the operand body. Covers integrals, sums, products, coproducts, and
 * the big set/logic operators.
 */
const LARGE_OPS = new Set([
  '∑', // ∑ sum
  '∏', // ∏ product
  '∐', // ∐ coproduct
  '∫', // ∫ integral
  '∬', // ∬ double integral
  '∭', // ∭ triple integral
  '∮', // ∮ contour integral
  '∯', // ∯ surface integral
  '⨀', // ⨀
  '⨁', // ⨁
  '⨂', // ⨂
  '⨄', // ⨄
  '⨆', // ⨆
  '⋀', // ⋀ big wedge
  '⋁', // ⋁ big vee
  '⋂', // ⋂ big intersection
  '⋃', // ⋃ big union
])

/**
 * Relation operators that terminate an n-ary operand body: the integrand /
 * summand does not extend past them (∫ f dx = … → body is just `f dx`).
 */
const RELATION_OPS = new Set([
  '=',
  '≠', // ≠
  '<',
  '>',
  '≤', // ≤
  '≥', // ≥
  '≈', // ≈
  '≡', // ≡
  '≅', // ≅
  '∝', // ∝
  '→', // →
  '←', // ←
  '↔', // ↔
  '↦', // ↦
  '∈', // ∈
  '⊆', // ⊆
  '⊂', // ⊂
])

/**
 * Binary arithmetic operators that terminate an n-ary body.
 * For ∑ x + y = z, the body should be just `x`; `+ y = z` stays at top level.
 */
const BINARY_ARITH_OPS = new Set([
  '+',
  '-',
  '×', // ×
  '·', // ·
  '÷', // ÷
  '±', // ±
  '∓', // ∓
  '⊕', // ⊕
  '⊗', // ⊗
  '∧', // ∧
  '∨', // ∨
])

/** Child *element* nodes (drops whitespace/text between pretty-printed tags). */
function childElements(node: Element): Element[] {
  return (node.elements ?? []).filter((e) => e.type === 'element') as Element[]
}

/** Concatenated text content of a token element (mi/mn/mo/mtext/ms). */
function textOf(node: Element): string {
  return (node.elements ?? [])
    .map((e) => (e.type === 'text' ? String(e.text ?? '') : e.type === 'cdata' ? String(e.cdata ?? '') : ''))
    .join('')
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escAttr(s: string): string {
  return escXml(s).replace(/"/g, '&quot;')
}

/** A plain math run carrying literal text. */
function run(text: string): string {
  return `<m:r><m:t xml:space="preserve">${escXml(text)}</m:t></m:r>`
}

function sSup(base: Element, sup: Element): string {
  return `<m:sSup><m:sSupPr><m:ctrlPr/></m:sSupPr><m:e>${convertNode(base)}</m:e><m:sup>${convertNode(sup)}</m:sup></m:sSup>`
}

function sSub(base: Element, sub: Element): string {
  return `<m:sSub><m:sSubPr><m:ctrlPr/></m:sSubPr><m:e>${convertNode(base)}</m:e><m:sub>${convertNode(sub)}</m:sub></m:sSub>`
}

function sSubSup(base: Element, sub: Element, sup: Element): string {
  return `<m:sSubSup><m:sSubSupPr><m:ctrlPr/></m:sSubSupPr><m:e>${convertNode(base)}</m:e><m:sub>${convertNode(sub)}</m:sub><m:sup>${convertNode(sup)}</m:sup></m:sSubSup>`
}

function frac(num: Element, den: Element): string {
  return `<m:f><m:fPr><m:ctrlPr/></m:fPr><m:num>${convertNode(num)}</m:num><m:den>${convertNode(den)}</m:den></m:f>`
}

/** √ with hidden (empty) degree. */
function sqrt(children: Element[]): string {
  return `<m:rad><m:radPr><m:degHide m:val="on"/></m:radPr><m:deg/><m:e>${convertSequence(children)}</m:e></m:rad>`
}

/** ⁿ√ with a visible index. */
function root(base: Element, index: Element): string {
  return `<m:rad><m:radPr/><m:deg>${convertNode(index)}</m:deg><m:e>${convertNode(base)}</m:e></m:rad>`
}

/** True if `node` is an `<mo>` whose glyph is a large (n-ary) operator. */
function isLargeOpMo(node: Element | undefined): boolean {
  return !!node && node.name === 'mo' && LARGE_OPS.has(textOf(node).trim())
}

/** True if `node` is an `<mo>` that ends an n-ary operand body. */
function isRelationMo(node: Element): boolean {
  return node.name === 'mo' && RELATION_OPS.has(textOf(node).trim())
}

function isBinaryArithMo(node: Element): boolean {
  return node.name === 'mo' && BINARY_ARITH_OPS.has(textOf(node).trim())
}

const OPEN_FENCES = new Set(['(', '[', '{', '\u2308', '\u230a', '\u27e8', '|', '\u2016'])
const CLOSE_FENCES = new Set([')', ']', '}', '\u2309', '\u230b', '\u27e9', '|', '\u2016'])
/**
 * Bracket-depth delta for an operand-body `mo`. An opening fence returns +1, a
 * closing fence -1, everything else 0. This lets the n-ary body scan skip a
 * relation/binary-arith operator that lives *inside* parentheses (e.g. the `+`
 * in `\int (x+1)\,dx`) instead of truncating the operand there. Ambiguous
 * fences (`|`, `\u2016`) that are both open and close are treated as neutral so
 * they never push depth negative or swallow the real terminator.
 */
function fenceDepthDelta(node: Element): number {
  if (!node || node.name !== 'mo') return 0
  const t = textOf(node).trim()
  const isOpen = OPEN_FENCES.has(t)
  const isClose = CLOSE_FENCES.has(t)
  if (isOpen && isClose) return 0 // ambiguous (|): treat as neutral
  if (isOpen) return 1
  if (isClose) return -1
  return 0
}

interface NaryInfo {
  chr: string
  sub?: Element
  sup?: Element
  limLoc: 'subSup' | 'undOvr'
}

/**
 * If `node` introduces a large operator (bare, or scripted with limits),
 * describe it as an n-ary; otherwise return null.
 */
function naryInfo(node: Element): NaryInfo | null {
  if (node.name === 'mo' && LARGE_OPS.has(textOf(node).trim())) {
    return { chr: textOf(node).trim(), limLoc: 'subSup' }
  }
  const kids = childElements(node)
  if (!isLargeOpMo(kids[0])) return null
  const chr = textOf(kids[0]).trim()
  switch (node.name) {
    case 'msubsup':
      return { chr, sub: kids[1], sup: kids[2], limLoc: 'subSup' }
    case 'munderover':
      return { chr, sub: kids[1], sup: kids[2], limLoc: 'undOvr' }
    case 'msub':
      return { chr, sub: kids[1], limLoc: 'subSup' }
    case 'munder':
      return { chr, sub: kids[1], limLoc: 'undOvr' }
    case 'msup':
      return { chr, sup: kids[1], limLoc: 'subSup' }
    case 'mover':
      return { chr, sup: kids[1], limLoc: 'undOvr' }
    default:
      return null
  }
}

/** Emit an `<m:nary>` with its limits and a (possibly empty) operand body. */
function emitNary(info: NaryInfo, body: Element[]): string {
  const subHide = info.sub ? 'off' : 'on'
  const supHide = info.sup ? 'off' : 'on'
  const sub = info.sub ? `<m:sub>${convertNode(info.sub)}</m:sub>` : '<m:sub/>'
  const sup = info.sup ? `<m:sup>${convertNode(info.sup)}</m:sup>` : '<m:sup/>'
  const e = `<m:e>${convertSequence(body)}</m:e>`
  return (
    `<m:nary><m:naryPr>` +
    `<m:chr m:val="${escAttr(info.chr)}"/>` +
    `<m:limLoc m:val="${info.limLoc}"/>` +
    `<m:subHide m:val="${subHide}"/>` +
    `<m:supHide m:val="${supHide}"/>` +
    `<m:ctrlPr/></m:naryPr>${sub}${sup}${e}</m:nary>`
  )
}

/**
 * Convert a sequence of sibling MathML nodes. This is where n-ary operators
 * pull their trailing siblings into `<m:e>` (up to the next relation op).
 */
function convertSequence(nodes: Element[]): string {
  let out = ''
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    const nary = naryInfo(node)
    if (nary) {
      const body: Element[] = []
      let j = i + 1
      let depth = 0
      while (j < nodes.length) {
        // Only a top-level (depth 0) relation/binary-arith operator ends the
        // operand; one nested inside a fence stays part of the body.
        if (depth === 0 && (isRelationMo(nodes[j]) || isBinaryArithMo(nodes[j]))) break
        depth += fenceDepthDelta(nodes[j])
        if (depth < 0) depth = 0 // unbalanced close: clamp, don't go negative
        body.push(nodes[j])
        j++
      }
      out += emitNary(nary, body)
      i = j
      continue
    }
    out += convertNode(node)
    i++
  }
  return out
}

/** Convert a single MathML element to an OMML fragment. */
function convertNode(node: Element): string {
  if (!node) throw new Error('missing MathML child node')
  const kids = childElements(node)
  switch (node.name) {
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms':
      return run(textOf(node))
    case 'mspace':
      return ''
    // Grouping / styling wrappers are transparent in OMML.
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'menclose':
    case 'mphantom':
      return convertSequence(kids)
    case 'msup':
      return sSup(kids[0], kids[1])
    case 'msub':
      return sSub(kids[0], kids[1])
    case 'msubsup':
      return sSubSup(kids[0], kids[1], kids[2])
    // No native OMML "under/over"; approximate with scripts (rare off the
    // n-ary path, e.g. \overrightarrow — good enough, and never empty).
    case 'mover':
      return sSup(kids[0], kids[1])
    case 'munder':
      return sSub(kids[0], kids[1])
    case 'munderover':
      return sSubSup(kids[0], kids[1], kids[2])
    case 'mfrac':
      return frac(kids[0], kids[1])
    case 'msqrt':
      return sqrt(kids)
    case 'mroot':
      return root(kids[0], kids[1])
    default:
      throw new Error(`unsupported MathML element <${node.name ?? '?'}>`)
  }
}

/**
 * Convert a serialized MathML `<math>` document into an OMML `<m:oMath>`
 * string. Throws on malformed input or unsupported structures so the caller
 * can fall back to the raw LaTeX source.
 */
export function mathmlToOmml(mathml: string): string {
  const parsed = xml2js(mathml, { compact: false }) as Element
  const math = (parsed.elements ?? []).find(
    (e) => e.type === 'element' && e.name === 'math',
  ) as Element | undefined
  if (!math) throw new Error('no <math> root element in MathML')
  const body = convertSequence(childElements(math))
  return `<m:oMath xmlns:m="${MATH_NS}">${body}</m:oMath>`
}
