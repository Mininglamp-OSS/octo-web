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

/**
 * Current math text color (a 6-hex RRGGBB string) while converting inside an
 * `<mstyle mathcolor>` subtree, or null. OMML has no subtree color wrapper, so
 * we thread it down and stamp each run's `<m:rPr>`, which is how Word carries
 * math run color. A stack supports nested/overriding color scopes.
 */
const colorStack: string[] = []
function currentColor(): string | null {
  return colorStack.length ? colorStack[colorStack.length - 1]! : null
}

/** Normalize a MathML color (name or #hex) to a 6-hex RRGGBB, or null. */
function normalizeColor(raw: string | undefined): string | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  const NAMES: Record<string, string> = {
    red: 'FF0000', blue: '0000FF', green: '008000', black: '000000',
    white: 'FFFFFF', yellow: 'FFFF00', orange: 'FFA500', purple: '800080',
    gray: '808080', grey: '808080', cyan: '00FFFF', magenta: 'FF00FF',
  }
  if (NAMES[v]) return NAMES[v]
  const hex = v.replace(/^#/, '')
  if (/^[0-9a-f]{6}$/.test(hex)) return hex.toUpperCase()
  if (/^[0-9a-f]{3}$/.test(hex)) return hex.split('').map((c) => c + c).join('').toUpperCase()
  return null
}

/** A plain math run carrying literal text (with the active color, if any). */
function run(text: string): string {
  const color = currentColor()
  const rPr = color ? `<m:rPr><w:color w:val="${color}"/></m:rPr>` : ''
  return `<m:r>${rPr}<m:t xml:space="preserve">${escXml(text)}</m:t></m:r>`
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

function frac(num: Element, den: Element, noBar = false): string {
  // A zero line-thickness fraction is a binomial-style stack (\binom): OMML
  // represents it with `<m:type m:val="noBar"/>`. Without this the bar shows up
  // as a spurious horizontal line on round-trip.
  const typeProp = noBar ? '<m:type m:val="noBar"/>' : ''
  return `<m:f><m:fPr>${typeProp}<m:ctrlPr/></m:fPr><m:num>${convertNode(num)}</m:num><m:den>${convertNode(den)}</m:den></m:f>`
}

/** √ with hidden (empty) degree. */
function sqrt(children: Element[]): string {
  return `<m:rad><m:radPr><m:degHide m:val="on"/></m:radPr><m:deg/><m:e>${convertSequence(children)}</m:e></m:rad>`
}

/** ⁿ√ with a visible index. */
function root(base: Element, index: Element): string {
  return `<m:rad><m:radPr/><m:deg>${convertNode(index)}</m:deg><m:e>${convertNode(base)}</m:e></m:rad>`
}

/**
 * Non-stretchy diacritic accents (\hat \vec \dot \ddot \tilde \check \acute
 * \grave \breve …). MathJax renders these as `<mover><base><mo>accent</mo></mover>`
 * with a small, non-stretchy accent glyph. Mapping them to a superscript (the old
 * behavior) shoves the mark up-and-to-the-right of the base instead of centering
 * it on top — the "符号偏移" bug. OMML `<m:acc>` places a combining accent centered
 * over the base, which is what Word/LaTeX both do.
 *
 * Values are the *combining* code points Word expects in `<m:chr>`; several source
 * glyphs (spacing ^ ~ ¨ ˙, or the → arrow) must be normalized to their combining
 * form so the accent actually stacks on the base rather than sitting beside it.
 */
const ACCENT_CHARS: Record<string, string> = {
  '^': '\u0302', // \hat  → combining circumflex
  '\u02c6': '\u0302', // ˆ modifier circumflex
  '~': '\u0303', // \tilde → combining tilde
  '\u02dc': '\u0303', // ˜ small tilde
  '\u00af': '\u0304', // ¯ macron → combining macron (\bar)
  '\u0304': '\u0304', // combining macron
  '\u02d9': '\u0307', // ˙ dot above → combining dot (\dot)
  '\u0307': '\u0307',
  '\u00a8': '\u0308', // ¨ diaeresis → combining diaeresis (\ddot)
  '\u0308': '\u0308',
  '\u02c7': '\u030c', // ˇ caron → combining caron (\check)
  '\u00b4': '\u0301', // ´ acute → combining acute (\acute)
  '`': '\u0300', // grave → combining grave (\grave)
  '\u02d8': '\u0306', // ˘ breve → combining breve (\breve)
  '\u2192': '\u20d7', // → arrow → combining right arrow above (\vec)
  '\u21c0': '\u20d7', // ⇀ harpoon (\vec variant)
  '\u2190': '\u20d6', // ← combining left arrow above
}

/** True when `over` is a small diacritic accent (not a stretchy brace/bar). */
function accentChar(over: Element | undefined): string | undefined {
  if (!over || over.name !== 'mo') return undefined
  return ACCENT_CHARS[textOf(over).trim()]
}

/**
 * True when an accent `<mo>` is stretchy (wide). MathJax marks NARROW accents
 * (\hat \vec over a single token) with `stretchy="false"`; the WIDE variants
 * (\overrightarrow \widehat \widetilde over a multi-token base) omit it and are
 * stretchy by default. Stretchy accents must become a `<m:groupChr>` so the mark
 * spans the whole base instead of shrinking to a centered combining glyph.
 */
function isStretchyAccent(over: Element | undefined): boolean {
  if (!over || over.name !== 'mo') return false
  return over.attributes?.stretchy !== 'false'
}

/**
 * Combining accent → the stretchy glyph OMML uses for its WIDE form in
 * `<m:groupChr>`. Only accents that have a genuine wide TeX variant appear here
 * (\overrightarrow, \widehat, \widetilde, \overline-as-bar); the rest fall back
 * to the narrow `<m:acc>`.
 */
const WIDE_ACCENT_CHARS: Record<string, string> = {
  '\u20d7': '\u2192', // combining right arrow → stretchy → (\overrightarrow)
  '\u20d6': '\u2190', // combining left arrow → stretchy ← (\overleftarrow)
  '\u0302': '\u0302', // circumflex (\widehat) — stretchy caret over the base
  '\u0303': '\u0303', // tilde (\widetilde) — stretchy tilde over the base
  '\u0304': '\u2015', // macron → horizontal bar (\overline over wide base)
}

/** `<m:acc>` — a combining accent centered over the base. */
function accent(base: Element, chr: string): string {
  return `<m:acc><m:accPr><m:chr m:val="${escAttr(chr)}"/><m:ctrlPr/></m:accPr><m:e>${convertNode(base)}</m:e></m:acc>`
}

/**
 * Stretchy over/under characters used by \overbrace ⏞ (U+23DE), \underbrace ⏟
 * (U+23DF), \overline ‾ / macron, and \underline. OMML `<m:groupChr>` draws a
 * single stretchy glyph above or below the base that grows to the base width —
 * exactly the brace/line behavior. `pos` places the glyph, `vertJc` aligns the
 * base to the opposite edge.
 */
const GROUP_CHARS: Record<string, 'top' | 'bot'> = {
  '\u23de': 'top', // ⏞ over-brace
  '\u23df': 'bot', // ⏟ under-brace
  '\u23b4': 'top', // ⎴ top square bracket
  '\u23b5': 'bot', // ⎵ bottom square bracket
  '\u0332': 'bot', // combining low line (\underline)
  '\u005f': 'bot', // _ underline glyph
  '\u2015': 'top', // ― horizontal bar
}

/** `<m:groupChr>` — a stretchy brace/line above or below the base. */
function groupChr(base: Element, chr: string, pos: 'top' | 'bot'): string {
  const vertJc = pos === 'top' ? 'bot' : 'top'
  return (
    `<m:groupChr><m:groupChrPr><m:chr m:val="${escAttr(chr)}"/>` +
    `<m:pos m:val="${pos}"/><m:vertJc m:val="${vertJc}"/><m:ctrlPr/></m:groupChrPr>` +
    `<m:e>${convertNode(base)}</m:e></m:groupChr>`
  )
}

/**
 * Handle an `<mover>`/`<munder>` whose script child is a stretchy group glyph
 * (over/under-brace, over/under-line). The label that \overbrace{…}^{n} adds is
 * an *outer* mover/munder wrapping this inner one; the caller resolves that as a
 * normal sub/sup on top of the group. Returns null when the script is not a
 * group character.
 */
function groupCharOf(node: Element): { base: Element; chr: string; pos: 'top' | 'bot' } | null {
  const kids = childElements(node)
  const script = kids[1]
  if (!script || script.name !== 'mo') return null
  const chr = textOf(script).trim()
  const pos = GROUP_CHARS[chr]
  if (!pos) return null
  if ((node.name === 'mover' && pos !== 'top') || (node.name === 'munder' && pos !== 'bot')) {
    return null
  }
  return { base: kids[0], chr, pos }
}

/** `<m:limUpp>` — places `lim` centered *above* the base (e.g. \overset, x→y arrow label). */
function limUpp(baseOmml: string, limOmml: string): string {
  return `<m:limUpp><m:limUppPr><m:ctrlPr/></m:limUppPr><m:e>${baseOmml}</m:e><m:lim>${limOmml}</m:lim></m:limUpp>`
}

/** `<m:limLow>` — places `lim` centered *below* the base (e.g. \underset). */
function limLow(baseOmml: string, limOmml: string): string {
  return `<m:limLow><m:limLowPr><m:ctrlPr/></m:limLowPr><m:e>${baseOmml}</m:e><m:lim>${limOmml}</m:lim></m:limLow>`
}

/**
 * Convert an `<mover>`/`<munder>` element. Priority:
 *   1. a small diacritic accent (\hat \vec \dot …) → `<m:acc>` centered on top;
 *   2. a stretchy group glyph (\overbrace \underbrace \overline …) → `<m:groupChr>`;
 *   3. the label of `\overbrace{body}^{label}` — an outer mover wrapping an inner
 *      group-char mover — → script (sub/sup) sitting on the braced group;
 *   4. anything else → sub/sup approximation (never empty).
 */
function overUnder(node: Element, kind: 'over' | 'under'): string {
  const kids = childElements(node)
  const base = kids[0]
  const script = kids[1]
  // 1. Diacritic accent (over only; \hat \vec \dot \ddot \tilde \bar …).
  //    A NON-stretchy `<mo>` (MathJax marks narrow accents `stretchy="false"`)
  //    is a small combining accent → `<m:acc>`. A stretchy accent over a wide
  //    base (\overrightarrow, \widehat, \widetilde) must instead stretch across
  //    the base, so it is emitted as a `<m:groupChr>` (step 2b) — using `<m:acc>`
  //    there shrinks the mark and spaces the letters (the "abc 太小" bug).
  if (kind === 'over') {
    const acc = accentChar(script)
    if (acc) {
      // A stretchy accent that has a genuine WIDE variant (\overrightarrow,
      // \widehat, \widetilde, \overline) over a wide base → `<m:groupChr>` so the
      // mark spans the base. Everything else (all narrow diacritics, incl. dot/
      // ddot which simply omit `stretchy`) stays a centered `<m:acc>`.
      const wide = WIDE_ACCENT_CHARS[acc]
      if (wide && isStretchyAccent(script)) return groupChr(base, wide, 'top')
      return accent(base, acc)
    }
  }
  // 2. Stretchy brace/line directly on this node.
  const grp = groupCharOf(node)
  if (grp) return groupChr(grp.base, grp.chr, grp.pos)
  // 3. \overbrace{...}^{n}: base carries the brace (possibly wrapped in an
  //    ORD/OP <mrow>); `script` is the label. Emit the braced group, then label.
  const innerNode =
    base && (base.name === 'mover' || base.name === 'munder')
      ? base
      : base && base.name === 'mrow'
        ? childElements(base).find((c) => c.name === 'mover' || c.name === 'munder')
        : undefined
  const inner = innerNode ? groupCharOf(innerNode) : null
  if (inner) {
    const grouped = groupChr(inner.base, inner.chr, inner.pos)
    return kind === 'over'
      ? limUpp(grouped, convertNode(script))
      : limLow(grouped, convertNode(script))
  }
  // 4. Fallback: an over/under script that is NOT a diacritic accent — e.g.
  //    \overset{n}{X}, \underset{i}{\star}, \stackrel{?}{=}, or the label on a
  //    stretchy arrow \xrightarrow{f}. These belong centered directly above /
  //    below the base, which is exactly what OMML's limit boxes do. Using a
  //    super/subscript instead shoves the mark to the base's upper/lower-right
  //    corner — the "符号不在正位置" bug for 28/34/35.
  return kind === 'over'
    ? limUpp(convertNode(base), convertNode(script))
    : limLow(convertNode(base), convertNode(script))
}

/**
 * Convert an `<mtable>` (matrix / cases body) into an OMML matrix `<m:m>`.
 * Each `<mtr>` becomes an `<m:mr>` row; each `<mtd>` becomes an `<m:e>` cell.
 * MathJax renders `\begin{pmatrix}…`, `\begin{cases}…`, etc. as an `<mtable>`
 * (usually wrapped by fence `<mo>` siblings for the brackets). Without this the
 * table hit the default branch and threw, forcing the whole formula to fall
 * back to raw LaTeX source in Word.
 *
 * A numbered equation (`\tag{}`, or a numbered `align`/`equation`/`gather`
 * environment) is emitted by MathJax as an `<mlabeledtr>` whose first `<mtd>`
 * holds the equation number and whose remaining cells hold the equation body.
 * OMML has no native per-row equation number, so we drop the label cell and
 * render the body cells like a normal row. Treating `mlabeledtr` as a plain
 * `mtr` (or omitting it) would silently drop the numbered equation entirely.
 */
function matrix(node: Element): string {
  const rows = childElements(node).filter((r) => r.name === 'mtr' || r.name === 'mlabeledtr')
  const mrs = rows
    .map((r) => {
      const cells = childElements(r).filter((c) => c.name === 'mtd')
      // In an `<mlabeledtr>` the first `<mtd>` is the equation-number label;
      // skip it so only the equation body is emitted (OMML has no row label).
      const bodyCells = r.name === 'mlabeledtr' ? cells.slice(1) : cells
      const es = bodyCells.map((c) => `<m:e>${convertSequence(childElements(c))}</m:e>`).join('')
      return `<m:mr>${es}</m:mr>`
    })
    .join('')
  return `<m:m><m:mPr><m:ctrlPr/></m:mPr>${mrs}</m:m>`
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
const FENCE_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '\u2308': '\u2309', // ⌈ ⌉
  '\u230a': '\u230b', // ⌊ ⌋
  '\u27e8': '\u27e9', // ⟨ ⟩
}

/** Symmetric fences where the open and close glyph are identical (| ‖). */
const SYMMETRIC_FENCES = new Set(['|', '\u2016'])

/** The `data-mjx-texclass` attribute of a node, if present (OPEN/CLOSE/…). */
function texClass(node: Element | undefined): string | undefined {
  const v = node?.attributes?.['data-mjx-texclass']
  return typeof v === 'string' ? v : undefined
}

/**
 * MathJax often wraps a bare bar `|` in `<mrow data-mjx-texclass="ORD"><mo>|</mo></mrow>`
 * (e.g. `|\vec a|`). Unwrap a single-child mrow so fence detection sees the `<mo>`.
 */
function unwrapSoleMo(node: Element | undefined): Element | undefined {
  if (!node) return undefined
  if (node.name === 'mo') return node
  if (node.name === 'mrow') {
    const inner = childElements(node)
    if (inner.length === 1 && inner[0].name === 'mo') return inner[0]
  }
  return undefined
}

/**
 * If the node at `start` is an opening fence `<mo>`, scan for its matching
 * closing fence (respecting nested fence depth) and emit an OMML delimiter
 * `<m:d>` so Word auto-grows the brackets to their content height. Returns the
 * produced markup and the index just past the closing fence, or null when the
 * node is not an opening fence or has no matching close in this sequence.
 */
function tryConvertFenced(
  nodes: Element[],
  start: number,
): { omml: string; next: number } | null {
  const open = unwrapSoleMo(nodes[start])
  if (!open) return null
  const openChr = textOf(open).trim()

  // Symmetric bars (| ‖): open and close glyphs are identical, so we cannot rely
  // on glyph matching alone. Use the MathJax texclass hint when present
  // (OPEN…CLOSE, as around a vmatrix), otherwise pair the next same-glyph bar
  // (as in `|\vec a|`). Emitting a `<m:d>` makes Word grow the bars to the
  // content height instead of leaving tiny single-line `|` characters.
  if (SYMMETRIC_FENCES.has(openChr)) {
    const openClass = texClass(nodes[start]) ?? texClass(open)
    // Only treat as an opening bar when it is classed OPEN, or unclassed (a
    // plain `|` pair). A CLOSE-classed bar is someone else's terminator.
    if (openClass === 'CLOSE') return null
    for (let j = start + 1; j < nodes.length; j++) {
      const cand = unwrapSoleMo(nodes[j])
      if (!cand) continue
      if (textOf(cand).trim() === openChr) {
        const inner = convertSequence(nodes.slice(start + 1, j))
        const esc = escAttr(openChr)
        const omml =
          `<m:d><m:dPr><m:begChr m:val="${esc}"/><m:endChr m:val="${esc}"/>` +
          `<m:ctrlPr/></m:dPr><m:e>${inner}</m:e></m:d>`
        return { omml, next: j + 1 }
      }
    }
    return null
  }

  if (open.name !== 'mo') return null
  const closeChr = FENCE_PAIRS[openChr]
  if (!closeChr) return null
  // Find the matching close, honoring nesting of the same fence family.
  let depth = 0
  let end = -1
  for (let j = start + 1; j < nodes.length; j++) {
    const n = nodes[j]
    if (n.name === 'mo') {
      const t = textOf(n).trim()
      if (t === openChr && openChr !== closeChr) depth++
      else if (t === closeChr) {
        if (depth === 0) {
          end = j
          break
        }
        depth--
      }
    }
  }
  if (end === -1) {
    // Special case: a lone opening brace `{` immediately followed by an <mtable>
    // is MathJax's rendering of a `cases`/piecewise environment (there is no
    // matching closing brace). Emit a one-sided growing delimiter — begChr `{`,
    // empty endChr — wrapping the matrix, so Word draws a tall brace instead of
    // a tiny single-line `{` next to the rows.
    if (openChr === '{') {
      const nextEl = nodes[start + 1]
      if (nextEl && nextEl.name === 'mtable') {
        const inner = convertNode(nextEl)
        const omml =
          `<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/>` +
          `<m:ctrlPr/></m:dPr><m:e>${inner}</m:e></m:d>`
        return { omml, next: start + 2 }
      }
    }
    return null
  }
  const inner = convertSequence(nodes.slice(start + 1, end))
  const begEsc = escAttr(openChr)
  const endEsc = escAttr(closeChr)
  const omml =
    `<m:d><m:dPr><m:begChr m:val="${begEsc}"/><m:endChr m:val="${endEsc}"/>` +
    `<m:ctrlPr/></m:dPr><m:e>${inner}</m:e></m:d>`
  return { omml, next: end + 1 }
}

function convertSequence(nodes: Element[]): string {
  let out = ''
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    // A fenced group `(...)` `[...]` `{...}` etc. becomes an OMML delimiter
    // `<m:d>` so Word auto-grows the brackets to the height of their content
    // (e.g. matrices / column vectors). Without this the fences are literal
    // single-height `(` `)` characters that look far too small around a matrix.
    const fenced = tryConvertFenced(nodes, i)
    if (fenced) {
      out += fenced.omml
      i = fenced.next
      continue
    }
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
    case 'mpadded':
    case 'menclose':
    case 'mphantom':
      return convertSequence(kids)
    case 'mstyle': {
      // `\color{…}` / `\textcolor{…}{…}` compile to `<mstyle mathcolor>`. OMML
      // carries color per run, so push the color while converting the subtree.
      const color = normalizeColor(node.attributes?.mathcolor as string | undefined)
      if (!color) return convertSequence(kids)
      colorStack.push(color)
      try {
        return convertSequence(kids)
      } finally {
        colorStack.pop()
      }
    }
    case 'msup':
      return sSup(kids[0], kids[1])
    case 'msub':
      return sSub(kids[0], kids[1])
    case 'msubsup':
      return sSubSup(kids[0], kids[1], kids[2])
    // No native OMML "under/over"; approximate with scripts (rare off the
    // n-ary path, e.g. \overrightarrow — good enough, and never empty).
    case 'mover':
      return overUnder(node, 'over')
    case 'munder':
      return overUnder(node, 'under')
    case 'munderover':
      return sSubSup(kids[0], kids[1], kids[2])
    case 'mfrac': {
      const lt = node.attributes?.linethickness
      const noBar = typeof lt === 'string' && /^0(\.0+)?(em|px|pt)?$/.test(lt.trim())
      return frac(kids[0], kids[1], noBar)
    }
    case 'msqrt':
      return sqrt(kids)
    case 'mroot':
      return root(kids[0], kids[1])
    case 'mtable':
      return matrix(node)
    case 'mtr':
    case 'mtd':
      // Normally consumed by matrix(); if one appears standalone, flatten it.
      return convertSequence(kids)
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
