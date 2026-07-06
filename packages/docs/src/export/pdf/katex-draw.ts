/**
 * Draw a measured KaTeX layout into a jsPDF document as real text + rules.
 *
 * Takes the px-space layout from extractMathLayout and paints it at a target
 * position and target font size (mm), producing normally-rendered math whose
 * glyphs are selectable PDF text. No SVG, no raster.
 */

import type { jsPDF } from 'jspdf'
import type { MathLayout } from './katex-render.ts'

export interface DrawnMath {
  /** Rendered width in mm. */
  widthMm: number
  /** Rendered height in mm. */
  heightMm: number
  /** Baseline offset from the top of the drawn box, in mm. */
  baselineMm: number
}

/**
 * Draw the layout with its top-left at (xMm, topMm). `scale` maps the layout's
 * intrinsic 16px font-size world onto the desired output: we render KaTeX at
 * 16px, so scale = targetEmMm / (16 * PX_TO_MM) makes a 16px glyph become
 * targetEmMm tall.
 *
 * @returns the drawn box metrics (mm).
 */
export function drawMathLayout(
  pdf: jsPDF,
  layout: MathLayout,
  xMm: number,
  topMm: number,
  targetEmMm: number,
): DrawnMath {
  // KaTeX host was rendered at font-size 16px, so 16px == 1 em. We want a
  // 16px-tall glyph to become `targetEmMm` tall in the PDF. So mm-per-px is
  // simply targetEmMm/16 (do NOT fold PX_TO_MM in here — px coords map to mm
  // through this single factor; the earlier version double-applied PX_TO_MM,
  // which blew the font size up ~3.8x and piled all glyphs together).
  const emPx = 16
  const mmPerPx = targetEmMm / emPx

  pdf.setTextColor(0, 0, 0)

  for (const item of layout.items) {
    if (item.kind === 'glyph' && item.text) {
      const font = item.font || 'KaTeX_Main'
      const sizePx = item.fontSizePx || emPx
      // px font-size → mm (× mmPerPx) → pt (× 72/25.4).
      const sizePt = sizePx * mmPerPx * (72 / 25.4)
      try {
        pdf.setFont(font, 'normal')
      } catch {
        pdf.setFont('KaTeX_Main', 'normal')
      }
      pdf.setFontSize(sizePt)
      const gx = xMm + item.x * mmPerPx
      const gy = topMm + item.y * mmPerPx
      // Anchor by the glyph's top edge (see katex-render: y is rect.top). This
      // keeps glyphs on the same math row vertically consistent.
      pdf.text(item.text, gx, gy, { baseline: 'top' })
    } else if (item.kind === 'rule') {
      const rx = xMm + item.x * mmPerPx
      const ry = topMm + item.y * mmPerPx
      const rw = (item.width || 0) * mmPerPx
      const rh = Math.max((item.height || 0.6) * mmPerPx, 0.15)
      pdf.setFillColor(0, 0, 0)
      pdf.rect(rx, ry, rw, rh, 'F')
    } else if (item.kind === 'radical' && item.radical) {
      drawRadical(pdf, item.radical, xMm, topMm, mmPerPx)
    }
  }

  return {
    widthMm: layout.widthPx * mmPerPx,
    heightMm: layout.heightPx * mmPerPx,
    baselineMm: layout.baselinePx * mmPerPx,
  }
}

/**
 * Stroke a radical sign (√) as a connected polyline covering the given sqrt
 * box, plus the horizontal vinculum along the box top. This is drawn with
 * vector line segments (same category as a fraction bar), so it looks like a
 * real √, connects cleanly to the vinculum, and stretches to any width.
 *
 * box coords are px, relative to the formula; xMm/topMm/mmPerPx map to PDF mm.
 */
function drawRadical(
  pdf: jsPDF,
  box: { x: number; y: number; width: number; height: number },
  xMm: number,
  topMm: number,
  mmPerPx: number,
): void {
  const bx = xMm + box.x * mmPerPx
  const by = topMm + box.y * mmPerPx
  const bw = box.width * mmPerPx
  const bh = box.height * mmPerPx

  // Radical sign occupies a fixed-ish left gutter scaled to height.
  const sign = Math.min(bh * 0.5, bw * 0.5)
  const lw = Math.max(bh * 0.05, 0.2)
  pdf.setLineWidth(lw)
  pdf.setDrawColor(0, 0, 0)
  const anyPdf = pdf as unknown as { setLineJoin?: (s: string) => void; setLineCap?: (s: string) => void }
  anyPdf.setLineJoin?.('round')
  anyPdf.setLineCap?.('round')

  // Polyline points (mm). The √: small entry tick → deep V bottom → up to the
  // top-left corner → horizontal vinculum across the top to the right edge.
  const x0 = bx
  const yTick = by + bh * 0.62
  const xDown = bx + sign * 0.35
  const yDown = by + bh - lw / 2 // bottom of the V
  const xUp = bx + sign * 0.7
  const yTop = by + lw / 2 // vinculum height
  const xRight = bx + bw

  const seg = (x1: number, y1: number, x2: number, y2: number) => pdf.line(x1, y1, x2, y2)
  seg(x0, yTick, xDown, yDown) // entry tick down into the V bottom
  seg(xDown, yDown, xUp, yTop) // up stroke to the top-left of the vinculum
  seg(xUp, yTop, xRight, yTop) // horizontal vinculum across the radicand top
}
