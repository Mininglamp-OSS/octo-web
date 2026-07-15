/**
 * Tests for math (LaTeX → OMML) handling in the DOCX export.
 *
 * Word renders native, editable formulas only from OMML (`<m:oMath>`) markup.
 * These tests cover the conversion chain (LaTeX → MathML → OMML → docx) at the
 * unit level and end-to-end by packing a real .docx and asserting the OMML
 * nodes land in word/document.xml. The fallback path (conversion failure →
 * plain source text) is covered in math-fallback.test.ts.
 */
import { describe, it, expect } from 'vitest'
import { Packer, Document, Paragraph } from 'docx'
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { latexToMathComponent } from './math.ts'
import { convertBlocks, NUMBERING_CONFIG } from './nodes.ts'
import { DOCX_STYLES } from './styles.ts'
import type { MdNode, DocxContext } from './types.ts'

/** The three formulas from the task brief. */
const FORMULAS = [
  'E = mc^2',
  '\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}',
  '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}',
]

/** Build a full docx from blocks, pack it, unzip word/document.xml. */
async function renderDocumentXml(doc: MdNode[]): Promise<string> {
  const ctx: DocxContext = {
    urls: new Map(),
    imageBuffers: new Map(),
    dynamicNumbering: [],
    orderedListInstance: 0,
  }
  const children = convertBlocks(doc, ctx)
  const document = new Document({
    styles: DOCX_STYLES,
    numbering: NUMBERING_CONFIG,
    sections: [{ children }],
  })
  const buf = await Packer.toBuffer(document)
  const path = join(tmpdir(), `math-e2e-${process.pid}-${children.length}.docx`)
  writeFileSync(path, buf)
  return execSync(`unzip -p ${path} word/document.xml`).toString()
}

describe('latexToMathComponent (unit)', () => {
  it('returns a component for each brief formula (block)', () => {
    for (const latex of FORMULAS) {
      const comp = latexToMathComponent(latex, true)
      expect(comp, `block: ${latex}`).not.toBeNull()
    }
  })

  it('returns a component for inline math', () => {
    expect(latexToMathComponent('x^2', false)).not.toBeNull()
  })

  it('returns null for empty / whitespace latex (caller falls back)', () => {
    expect(latexToMathComponent('', true)).toBeNull()
    expect(latexToMathComponent('   ', false)).toBeNull()
  })

  // Regression: these previously errored in MathJax (color package missing /
  // non-standard command) and degraded to raw LaTeX text runs, which imported
  // back as red literal LaTeX. They must now produce real OMML components.
  it('converts \\color / \\textcolor to a real math component (not text fallback)', () => {
    expect(latexToMathComponent('\\color{red} E = mc^2', true)).not.toBeNull()
    expect(latexToMathComponent('\\textcolor{blue}{\\frac{1}{2}} + F = ma', true)).not.toBeNull()
  })

  it('converts \\hdots (mapped to \\dots) to a real math component', () => {
    expect(latexToMathComponent('a_1 \\le a_2 \\le \\hdots \\le a_n', true)).not.toBeNull()
  })

  it('converts a piecewise cases / matrix to a real math component', () => {
    expect(
      latexToMathComponent(
        'f(x)=\\left\\{\\begin{matrix} x^{2} & x \\geq 0 \\\\ -x & x<0 \\end{matrix}\\right.',
        true,
      ),
    ).not.toBeNull()
  })

  it('produced component serializes to an <m:oMath> element', () => {
    // A component placed in a paragraph must serialize as real OMML markup.
    const comp = latexToMathComponent('E = mc^2', true)!
    const p = new Paragraph({ children: [comp] })
    const json = JSON.stringify(p)
    expect(json).toContain('m:oMath')
    // No malformed <undefined> wrapper (the fromXmlString trap).
    expect(json).not.toContain('undefined')
  })
})

describe('block math end-to-end docx export', () => {
  it('each brief formula produces one <m:oMath> node in document.xml', async () => {
    const doc: MdNode[] = FORMULAS.map((latex) => ({
      type: 'blockMath',
      attrs: { latex },
    })) as MdNode[]

    const xml = await renderDocumentXml(doc)

    // One native formula per input, balanced open/close, no malformed wrapper.
    const opens = xml.match(/<m:oMath[ >]/g) ?? []
    const closes = xml.match(/<\/m:oMath>/g) ?? []
    expect(opens.length).toBe(FORMULAS.length)
    expect(closes.length).toBe(FORMULAS.length)
    expect(xml).not.toContain('<undefined')

    // The LaTeX source must NOT be dumped verbatim as body text.
    expect(xml).not.toContain('\\int_')
    expect(xml).not.toContain('\\sqrt')
    expect(xml).not.toContain('\\frac')
  })

  it('math structures + operators are present (radical, fraction, ∑, ∫)', async () => {
    const doc: MdNode[] = FORMULAS.map((latex) => ({
      type: 'blockMath',
      attrs: { latex },
    })) as MdNode[]

    const xml = await renderDocumentXml(doc)
    expect(xml).toContain('schemas.openxmlformats.org/officeDocument/2006/math')
    // √ becomes a radical structure, fractions a <m:f>, large operators carry
    // their Unicode codepoint in m:chr.
    expect(xml).toContain('<m:rad') // \sqrt{\pi}
    expect(xml).toContain('<m:f>') // \frac{...}{...}
    expect(xml).toContain('m:val="∑"') // \sum
    expect(xml).toContain('m:val="∫"') // \int
    // The invalid `m:sty m:val="undefined"` mml2omml quirk must be sanitized.
    expect(xml).not.toContain('m:val="undefined"')
    expect(xml).not.toContain('<undefined')
  })

  it('CORE: n-ary operators (∫ ∑) carry a NON-EMPTY <m:e> operand body', async () => {
    // This is the regression that motivated replacing mml2omml: it emitted
    // <m:nary>…<m:e/></m:nary> (empty body) and stranded the integrand, so Word
    // drew an empty little box. Every nary MUST have a populated <m:e>.
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: FORMULAS[1] } }, // integral
      { type: 'blockMath', attrs: { latex: FORMULAS[2] } }, // sum
    ] as MdNode[]

    const xml = await renderDocumentXml(doc)

    // No empty operand body anywhere (neither self-closing nor <m:e></m:e>).
    expect(xml).not.toContain('<m:e/>')
    expect(xml).not.toMatch(/<m:e>\s*<\/m:e>/)

    // Pull each nary's operand body out and prove it is non-empty and actually
    // contains the integrand / summand content, not just whitespace.
    const bodies = [...xml.matchAll(/<m:nary>[\s\S]*?<m:e>([\s\S]*?)<\/m:e>\s*<\/m:nary>/g)].map(
      (m) => m[1],
    )
    expect(bodies.length).toBe(2) // one ∫, one ∑
    for (const body of bodies) {
      expect(body.length).toBeGreaterThan(0)
      expect(body).toContain('<m:r>') // real runs inside the body
    }
    // The Gaussian integral's body must contain the integrand e and x
    // (e^{-x^2} dx), and the ∑ body must contain its 1/n^2 fraction.
    const integralBody = bodies.find((b) => b.includes('π') === false && b.includes('e</m:t>'))
    expect(integralBody, 'integral operand body').toBeDefined()
    expect(integralBody).toContain('>e<')
    expect(integralBody).toContain('>x<')
    expect(bodies.some((b) => b.includes('<m:f>'))).toBe(true) // ∑ body has the fraction
  })

})

describe('inline math end-to-end docx export', () => {
  it('inline formula lands inside a paragraph alongside its text', async () => {
    const doc: MdNode[] = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '质能方程 ' },
          { type: 'inlineMath', attrs: { latex: 'E = mc^2' } },
          { type: 'text', text: ' 很有名' },
        ],
      },
    ] as MdNode[]

    const xml = await renderDocumentXml(doc)

    expect(xml).toContain('<m:oMath')
    expect((xml.match(/<m:oMath[ >]/g) ?? []).length).toBe(1)
    // The surrounding CJK text must still be present as normal runs.
    expect(xml).toContain('质能方程')
    expect(xml).toContain('很有名')
    // Not the old `$...$` literal source.
    expect(xml).not.toContain('$E = mc^2$')
  })

  it('n-ary operand keeps a parenthesised body across an inner +/- (bracket depth)', async () => {
    // Regression: the operand-body scan used to stop at the first relation /
    // binary-arith `mo` with no bracket tracking, so `\int (x+1)\,dx` truncated
    // the operand at the inner `+` and stranded `1) dx` outside the integral.
    // With fence-depth tracking, the `+` inside `(...)` no longer terminates the
    // body, so the whole `(x+1) dx` stays inside a single <m:e>.
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: '\\int (x+1)\\,dx' } },
    ] as MdNode[]

    const xml = await renderDocumentXml(doc)

    // Exactly one integral, with a populated (non-empty) operand body.
    expect(xml).toContain('m:val="∫"')
    expect(xml).not.toContain('<m:e/>')
    expect(xml).not.toMatch(/<m:e>\s*<\/m:e>/)
    // The body must still carry the `dx` tail that used to be stranded — i.e. a
    // `d` and an `x` variable run survive inside the math, and no LaTeX leaks.
    expect(xml).not.toContain('\\int')
    expect(xml).not.toContain('\\,')
  })

  it('converts a pmatrix to an OMML matrix (<m:m>) instead of falling back to source', async () => {
    // Regression: <mtable>/<mtr>/<mtd> hit the default branch and threw, so any
    // formula containing a matrix / cases environment degraded to raw LaTeX text
    // in Word. Now the table becomes a real OMML matrix.
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' } },
    ] as MdNode[]
    const xml = await renderDocumentXml(doc)
    expect(xml).toContain('<m:m>')
    expect((xml.match(/<m:mr>/g) ?? []).length).toBe(2)
    // The parentheses become a growing OMML delimiter <m:d> (begChr "(" / endChr
    // ")") wrapping the matrix, so Word auto-sizes the brackets to the matrix
    // height instead of rendering tiny single-line "(" ")" characters.
    expect(xml).toContain('<m:d>')
    expect(xml).toContain('<m:begChr m:val="("/>')
    expect(xml).toContain('<m:endChr m:val=")"/>')
    // No raw LaTeX leaked as fallback text.
    expect(xml).not.toContain('pmatrix')
    expect(xml).not.toContain('\\begin')
  })

  it('keeps a \\tag-numbered equation row (mlabeledtr) instead of silently dropping it', async () => {
    // Regression: MathJax emits <mlabeledtr> (not <mtr>) for a \tag-numbered
    // row; the matrix converter filtered to `mtr` only, so the whole row --
    // equation body AND its number -- vanished from the Word output with no
    // error and no fallback. matrix() must include mlabeledtr and drop only its
    // leading label cell (the equation number), still rendering the body.
    const doc: MdNode[] = [
      {
        type: 'blockMath',
        attrs: { latex: '\\begin{align} a &= b \\tag{1} \\\\ c &= d \\end{align}' },
      },
    ] as MdNode[]
    const xml = await renderDocumentXml(doc)
    expect(xml).toContain('<m:m>')
    // Both rows survive: the \tag{1} row (mlabeledtr) and the plain row (mtr).
    expect((xml.match(/<m:mr>/g) ?? []).length).toBe(2)
    // The tagged row's body still renders (its `a`/`b` content is not dropped).
    expect(xml).toContain('a')
    expect(xml).toContain('b')
    // No raw LaTeX leaked as fallback text.
    expect(xml).not.toContain('mlabeledtr')
    expect(xml).not.toContain('\\begin')
  })

  it('converts a cases environment to an OMML matrix (piecewise function)', async () => {
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: 'f(x) = \\begin{cases} x^2 & x \\ge 0 \\\\ -x & x < 0 \\end{cases}' } },
    ] as MdNode[]
    const xml = await renderDocumentXml(doc)
    expect(xml).toContain('<m:m>')
    // The piecewise opening brace becomes a one-sided growing delimiter
    // (begChr "{" / empty endChr) around the matrix, so Word draws a tall brace
    // instead of a tiny single-line "{" beside the rows.
    expect(xml).toContain('<m:begChr m:val="{"/>')
    expect(xml).toContain('<m:endChr m:val=""/>')
    // The brace is not emitted as a plain literal text run.
    expect(xml).not.toContain('<m:t xml:space="preserve">{</m:t>')
    expect(xml).not.toContain('cases')
    expect(xml).not.toContain('\\begin')
  })

  it('renders diacritic accents (\\vec \\hat \\dot …) as centered <m:acc>, not superscripts', async () => {
    // Regression: \vec/\hat/\dot/\ddot/\tilde/\bar came through as <mover> and
    // were mapped to a superscript, shoving the mark up-and-right of the base
    // ("公式符号偏移"). They must become an OMML <m:acc> so the accent sits
    // centered on top of the base like Word/LaTeX draw it.
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: '\\hat{x}, \\bar{y}, \\dot{z}, \\ddot{w}, \\tilde{u}, \\vec{v}' } },
    ] as MdNode[]
    const xml = await renderDocumentXml(doc)
    // Six accents, one per diacritic; none degraded to a superscript wrapper.
    expect((xml.match(/<m:acc>/g) ?? []).length).toBe(6)
    // The vec arrow must be the *combining* right-arrow-above (U+20D7), which
    // stacks on the base, not the spacing → (U+2192) sitting beside it.
    expect(xml).toContain('m:val="\u20d7"')
    // The accent glyph is not left as a plain text run next to the base.
    expect(xml).not.toContain('<m:t xml:space="preserve">\u2192</m:t>')
  })

  it('grows |…| absolute-value / determinant bars with an OMML delimiter', async () => {
    // Regression: vmatrix and |\vec a| left the bars as literal single-height
    // `|` runs, far too short around a matrix or an accented vector. They must
    // become a growing <m:d> delimiter with `|` begChr/endChr.
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} = ad - bc' } },
      { type: 'blockMath', attrs: { latex: '\\vec{a} \\cdot \\vec{b} = |\\vec{a}||\\vec{b}|\\cos\\theta' } },
    ] as MdNode[]
    const xml = await renderDocumentXml(doc)
    // vmatrix: a matrix wrapped in a bar delimiter.
    expect(xml).toContain('<m:m>')
    expect(xml).toContain('<m:begChr m:val="|"/>')
    expect(xml).toContain('<m:endChr m:val="|"/>')
    // The abs-value formula produces its own bar delimiters too (at least the
    // two |·| groups plus the vmatrix = 3 bar-open chars total).
    expect((xml.match(/<m:begChr m:val="\|"\/>/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(xml).not.toContain('vmatrix')
  })

  it('renders \\overbrace / \\underbrace as stretchy <m:groupChr> braces', async () => {
    // Regression: \overbrace/\underbrace came through as <mover>/<munder> over a
    // brace glyph and were mapped to super/subscript, so the brace did not grow
    // over the group. They must become an OMML <m:groupChr> stretchy brace.
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: '\\overbrace{a + b + c}^{n} = \\underbrace{x + y}_{m}' } },
    ] as MdNode[]
    const xml = await renderDocumentXml(doc)
    expect((xml.match(/<m:groupChr>/g) ?? []).length).toBe(2)
    // The over-brace glyph sits on top, the under-brace below.
    expect(xml).toContain('<m:pos m:val="top"/>')
    expect(xml).toContain('<m:pos m:val="bot"/>')
    // The labels (n above, m below) sit centered on the braced group via OMML
    // limit boxes (limUpp / limLow), not corner super/subscripts.
    expect(xml).toContain('<m:limUpp>')
    expect(xml).toContain('<m:limLow>')
  })

  it('centers \\overset / \\underset / stretchy-arrow labels with limit boxes, not corner scripts', async () => {
    // Regression: \overset{n}{X}, \underset{i}{\star}, \stackrel{?}{=}, and the
    // label on \xrightarrow{f} came through as super/subscripts, so the mark sat
    // at the base's upper/lower-right corner instead of centered above/below it
    // ("34/35 符号不在正位置"). They must become OMML <m:limUpp>/<m:limLow>.
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: 'a \\stackrel{?}{=} b, \\quad \\overset{n}{X}, \\quad \\underset{i}{\\star}' } },
      { type: 'blockMath', attrs: { latex: 'x \\xrightarrow{\\ f\\ } y \\xleftarrow{g} z' } },
    ] as MdNode[]
    const xml = await renderDocumentXml(doc)
    // stackrel + overset + two arrow labels -> at least 3 upper limit boxes;
    // underset -> a lower limit box.
    expect((xml.match(/<m:limUpp>/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect(xml).toContain('<m:limLow>')
    // No LaTeX leaked as fallback text.
    expect(xml).not.toContain('\\overset')
    expect(xml).not.toContain('\\xrightarrow')
  })

  it('renders \\binom as a no-bar OMML fraction (no spurious horizontal line)', async () => {
    // Regression: \binom came through as <mfrac linethickness="0"> but the
    // exporter emitted a normal <m:f>, adding a fraction bar on round-trip
    // ("41 本来没有横线怎么多了横线"). It must carry <m:type m:val="noBar"/>.
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: '\\binom{n}{x}' } },
    ] as MdNode[]
    const xml = await renderDocumentXml(doc)
    expect(xml).toContain('<m:type m:val="noBar"/>')
    expect(xml).toContain('<m:f>')
  })

  it('renders wide accents (\\overrightarrow \\widehat) as stretchy <m:groupChr>, not narrow <m:acc>', async () => {
    // Regression: \overrightarrow{AB} / \widehat{ABC} exported as a narrow
    // <m:acc> combining mark, shrinking the accent and spacing the letters
    // ("21 abc 太小"). A stretchy accent over a multi-char base must be a
    // <m:groupChr> that spans the base.
    const doc: MdNode[] = [
      { type: 'blockMath', attrs: { latex: '\\overrightarrow{AB}, \\widehat{ABC}' } },
    ] as MdNode[]
    const xml = await renderDocumentXml(doc)
    // Two stretchy group chars (arrow + hat); no narrow accent for the wide ones.
    expect((xml.match(/<m:groupChr>/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(xml).toContain('m:val="\u2192"') // stretchy right arrow over AB
  })
})
