import { describe, it, expect } from 'vitest'
import { jsPDF } from 'jspdf'
import { renderBlocks } from './nodes.ts'
import {
  MARGIN_TOP,
  MARGIN_LEFT,
  CONTENT_WIDTH,
  CONTENT_HEIGHT,
} from './styles.ts'
import type { MdNode, PdfContext } from './types.ts'

// Build a code block long enough to span multiple pages (~120 lines).
const codeLines = Array.from({ length: 120 }, (_, i) => `const line${i} = ${i};`)
const DOC_CONTENT: MdNode[] = [
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Multi-page code block' }] },
  { type: 'codeBlock', content: [{ type: 'text', text: codeLines.join('\n') }] },
]

function renderToString(content: MdNode[]): string {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  pdf.setFont('helvetica', 'normal')
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
  const uri = pdf.output('datauristring')
  const b64 = uri.slice(uri.indexOf(',') + 1)
  return Buffer.from(b64, 'base64').toString('latin1')
}

describe('代码块跨页背景', () => {
  it('多页代码块每页都有灰色背景矩形', () => {
    const raw = renderToString(DOC_CONTENT)

    // Must span at least 2 pages.
    const pageCount = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length
    expect(pageCount).toBeGreaterThanOrEqual(2)

    // Each code-background is a filled rectangle: jsPDF serializes "F" rects as
    // "<x> <y> <w> <h> re\nf". A multi-page block draws one fill per page-segment.
    const rectFills = (raw.match(/\bre\s+f\b/g) || []).length
    expect(rectFills).toBeGreaterThanOrEqual(2)
  })

  it('单页代码块只有一个背景矩形', () => {
    const raw = renderToString([
      { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;\nconst y = 2;' }] },
    ])
    const rectFills = (raw.match(/\bre\s+f\b/g) || []).length
    expect(rectFills).toBe(1)
  })
})
