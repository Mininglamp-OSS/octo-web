import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as pdfjs from 'pdfjs-dist'
import { parsePdfToPmDoc, PDF_NO_TEXT_LAYER } from './pdf.ts'
import type { PmNode } from './markdown.ts'

// Run pdf.js on the main thread under vitest (no worker asset in the node test runtime).
beforeAll(() => {
  ;(pdfjs.GlobalWorkerOptions as { workerSrc: string }).workerSrc = ''
  ;(pdfjs as unknown as { disableWorker?: boolean }).disableWorker = true
})

function textOf(n: PmNode): string {
  if (n.text) return n.text
  return (n.content ?? []).map(textOf).join('')
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

// Build a valid single-page PDF from object bodies + a correct xref table.
function buildPdf(objs: string[], extraRoot = ''): ArrayBuffer {
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R ${extraRoot} >>\nstartxref\n${xrefStart}\n%%EOF`
  return toArrayBuffer(Buffer.from(pdf, 'latin1'))
}

// A single text line "Hello World Title" via a Tj text-showing operator.
function textLayerPdf(): ArrayBuffer {
  const content = 'BT /F1 24 Tf 72 700 Td (Hello World Title) Tj ET'
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ])
}

// A valid page with no text-showing operator — stand-in for a scanned/image-only PDF.
function noTextPdf(): ArrayBuffer {
  const content = '0 0 0 rg'
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ])
}

describe('parsePdfToPmDoc', () => {
  it('extracts a text-layer line into a block with the correct text', async () => {
    const res = await parsePdfToPmDoc(textLayerPdf(), { disableWorker: true })
    expect(res.doc.type).toBe('doc')
    expect(res.doc.content!.length).toBeGreaterThan(0)
    const allText = res.doc.content!.map(textOf).join(' ')
    expect(allText).toContain('Hello World Title')
    // A lone line is its own baseline (no larger sibling to contrast), so it is a
    // paragraph and title is null — the caller then falls back to the file name.
    expect(res.title).toBeNull()
    // This hand-built PDF has no structure tree, so it imports via the font-metric path
    // and carries the untagged-PDF note.
    expect(res.warnings.some((w) => w.includes('无结构标签'))).toBe(true)
  })

  it('rejects a PDF with no text layer', async () => {
    await expect(parsePdfToPmDoc(noTextPdf(), { disableWorker: true })).rejects.toThrow(PDF_NO_TEXT_LAYER)
  })

  it('parses the real backend export fixture when present', async () => {
    const fixture = join(homedir(), '.openclaw/workspace-qilin/pdf_5173.pdf')
    let buf: Buffer
    try {
      buf = readFileSync(fixture)
    } catch {
      // Fixture is machine-local; skip cleanly elsewhere.
      return
    }
    const res = await parsePdfToPmDoc(toArrayBuffer(buf), { disableWorker: true })
    const types = new Set(res.doc.content!.map((n) => n.type))
    expect(res.doc.content!.length).toBeGreaterThan(3)
    expect(types.has('heading') || types.has('paragraph')).toBe(true)
    // The fixture is a tagged PDF: real tables and code blocks must be reconstructed
    // from the structure tree (no degradation to plain paragraphs).
    expect(types.has('table')).toBe(true)
    expect(types.has('codeBlock')).toBe(true)
    // Chinese must survive intact (no mojibake).
    const allText = res.doc.content!.map(textOf).join('')
    expect(allText).toMatch(/[\u4e00-\u9fff]/)
  })
})
