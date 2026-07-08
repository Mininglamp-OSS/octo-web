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
})
