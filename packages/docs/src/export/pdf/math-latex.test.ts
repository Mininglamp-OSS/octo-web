import { describe, it, expect } from 'vitest'
import { jsPDF } from 'jspdf'
import { renderBlocks } from './nodes.ts'
import { MARGIN_TOP, MARGIN_LEFT, CONTENT_WIDTH, CONTENT_HEIGHT } from './styles.ts'
import type { MdNode, PdfContext } from './types.ts'

function renderToText(content: MdNode[]): string {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  pdf.setFont('helvetica', 'normal')
  const ctx: PdfContext = {
    pdf, urls: new Map(), imageData: new Map(), y: MARGIN_TOP,
    contentWidth: CONTENT_WIDTH, contentHeight: CONTENT_HEIGHT,
    marginLeft: MARGIN_LEFT, marginTop: MARGIN_TOP, listDepth: 0, chineseFontLoaded: false,
  }
  renderBlocks(content, ctx)
  const uri = pdf.output('datauristring')
  const b64 = uri.slice(uri.indexOf(',') + 1)
  return Buffer.from(b64, 'base64').toString('latin1')
}

describe('PDF 公式导出为 LaTeX 源码文本', () => {
  it('块级公式输出 $$...$$ 的 LaTeX 源码（可选中，不转 Unicode/图像）', () => {
    const raw = renderToText([
      { type: 'blockMath', attrs: { latex: '\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}' } },
    ])
    // The PDF text stream must contain the raw LaTeX (jsPDF may split long
    // lines, so assert on distinctive fragments rather than the full string).
    expect(raw).toContain('sum_')
    expect(raw).toContain('frac')
    expect(raw).toContain('infty')
    // Not converted to Unicode symbols.
    expect(raw).not.toContain('∑')
    expect(raw).not.toContain('∞')
  })

  it('行内公式输出 $...$ 的 LaTeX 源码', () => {
    const raw = renderToText([
      { type: 'paragraph', content: [
        { type: 'text', text: 'x' },
        { type: 'inlineMath', attrs: { latex: 'E = mc^2' } },
      ] },
    ])
    expect(raw).toContain('mc^2')
    expect(raw).not.toContain('²')
  })
})
