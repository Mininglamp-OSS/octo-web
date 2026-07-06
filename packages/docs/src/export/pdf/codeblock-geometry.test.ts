import { describe, it, expect, vi } from 'vitest'
import { jsPDF } from 'jspdf'
import { renderBlocks } from './nodes.ts'
import {
  MARGIN_TOP,
  MARGIN_LEFT,
  CONTENT_WIDTH,
  CONTENT_HEIGHT,
} from './styles.ts'
import type { MdNode, PdfContext } from './types.ts'

// Long enough to span multiple pages.
const codeLines = Array.from({ length: 120 }, (_, i) => `const line${i} = ${i};`)
const DOC_CONTENT: MdNode[] = [
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Multi-page code block' }] },
  { type: 'codeBlock', content: [{ type: 'text', text: codeLines.join('\n') }] },
]

interface Op { page: number; kind: 'rect' | 'text'; y: number }

// Render and capture per-page rect fills and text baselines by spying on jsPDF.
function capture(content: MdNode[]): Op[] {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  pdf.setFont('helvetica', 'normal')
  const ops: Op[] = []
  let page = 1

  const origAddPage = pdf.addPage.bind(pdf)
  vi.spyOn(pdf, 'addPage').mockImplementation(((...a: unknown[]) => {
    page++
    // @ts-expect-error passthrough
    return origAddPage(...a)
  }) as typeof pdf.addPage)

  const origRect = pdf.rect.bind(pdf)
  vi.spyOn(pdf, 'rect').mockImplementation(((x: number, y: number, w: number, h: number, style?: string) => {
    if (style === 'F') ops.push({ page, kind: 'rect', y })
    return origRect(x, y, w, h, style as never)
  }) as typeof pdf.rect)

  const origText = pdf.text.bind(pdf)
  vi.spyOn(pdf, 'text').mockImplementation(((txt: unknown, x: number, y: number, ...rest: unknown[]) => {
    ops.push({ page, kind: 'text', y })
    // @ts-expect-error passthrough
    return origText(txt, x, y, ...rest)
  }) as typeof pdf.text)

  const ctx: PdfContext = {
    pdf,
    urls: new Map(),
    imageData: new Map(),
    y: MARGIN_TOP,
    contentWidth: CONTENT_WIDTH,
    contentHeight: CONTENT_HEIGHT,
    marginLeft: MARGIN_LEFT,
    marginTop: MARGIN_TOP,
    listDepth: 0,
    chineseFontLoaded: false,
  }
  renderBlocks(content, ctx)
  return ops
}

describe('代码块跨页背景几何', () => {
  it('每页的代码背景矩形顶部都在该页第一行代码文字之上（文字不高出灰框）', () => {
    const ops = capture(DOC_CONTENT)
    const pages = [...new Set(ops.map((o) => o.page))]
    expect(pages.length).toBeGreaterThanOrEqual(2)

    for (const p of pages) {
      const rects = ops.filter((o) => o.page === p && o.kind === 'rect')
      const texts = ops.filter((o) => o.page === p && o.kind === 'text')
      if (rects.length === 0 || texts.length === 0) continue
      // In jsPDF mm-space Y grows downward. The code background rect top-Y must
      // be <= the first code line's baseline-Y so the text sits INSIDE the box.
      const rectTop = Math.min(...rects.map((r) => r.y))
      const firstTextBaseline = Math.min(...texts.map((t) => t.y))
      expect(rectTop).toBeLessThanOrEqual(firstTextBaseline)
      // And there must be a real gap (padding) so ascenders are covered, not
      // sitting exactly on the box edge.
      expect(firstTextBaseline - rectTop).toBeGreaterThan(1)
    }
  })
})
