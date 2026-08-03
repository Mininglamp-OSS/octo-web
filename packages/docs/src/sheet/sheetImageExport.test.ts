import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import * as XLSX from 'xlsx-js-style'
import { injectImagesIntoXlsx, type ExportImage } from './sheetImageExport.ts'
import { parseXlsxToMatrix } from './xlsxImport.ts'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="red"/></svg>`
const SVG_DATA_URL = `data:image/svg+xml;base64,${btoa(SVG)}`
// Valid 1x1 PNG. The test deliberately supplies raster bytes distinct from the SVG source.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='

function workbook(): ArrayBuffer {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['svg']]), 'Sheet1')
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

function image(source: string): ExportImage {
  return { dataUrl: source, col: 0, row: 0, widthPx: 120, heightPx: 80 }
}

describe('sheet xlsx SVG image export', () => {
  it('rasterizes an SVG data URL and embeds non-empty, genuine PNG media', async () => {
    const rasterize = vi.fn(async () => PNG_DATA_URL)
    const output = await injectImagesIntoXlsx(workbook(), new Map([[1, [image(SVG_DATA_URL)]]]), rasterize)
    const zip = await JSZip.loadAsync(output)
    const media = zip.file('xl/media/image1.png')
    expect(media).not.toBeNull()
    const bytes = await media!.async('uint8array')
    expect(bytes.byteLength).toBeGreaterThan(8)
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(new TextDecoder().decode(bytes)).not.toContain('<svg')
    expect(rasterize).toHaveBeenCalledWith(SVG_DATA_URL, 120, 80)
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain(
      'Extension="png" ContentType="image/png"',
    )
    expect(await zip.file('xl/drawings/_rels/drawing1.xml.rels')!.async('string')).toContain(
      'Target="../media/image1.png"',
    )
  })

  it('round-trips non-empty sheet content and the rasterized SVG image through the product importer', async () => {
    const output = await injectImagesIntoXlsx(
      workbook(),
      new Map([[1, [image(SVG_DATA_URL)]]]),
      async () => PNG_DATA_URL,
    )

    const parsed = await parseXlsxToMatrix(output)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.sheets).toHaveLength(1)
    expect(parsed.data.sheets[0].matrix[0][0]).toMatchObject({ v: 'svg' })
    expect(parsed.data.sheets[0].drawings).toHaveLength(1)
    expect(parsed.data.sheets[0].drawings?.[0]).toMatchObject({ col: 0, row: 0 })
    expect(parsed.data.sheets[0].drawings?.[0].source).toMatch(/^data:image\/png;base64,/)
  })

  it('imports an image-only exported worksheet instead of reporting it as empty', async () => {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, { '!ref': 'A1:C5' }, 'Sheet1')
    const bare = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const output = await injectImagesIntoXlsx(bare, new Map([[1, [image(PNG_DATA_URL)]]]))

    const parsed = await parseXlsxToMatrix(output)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.data.sheets).toHaveLength(1)
    expect(parsed.data.sheets[0].drawings).toHaveLength(1)
  })

  it('resolves an SVG blob URL before rasterizing it to PNG', async () => {
    const blobUrl = URL.createObjectURL(new Blob([SVG], { type: 'image/svg+xml' }))
    try {
      const rasterize = vi.fn(async () => PNG_DATA_URL)
      const output = await injectImagesIntoXlsx(workbook(), new Map([[1, [image(blobUrl)]]]), rasterize)
      const zip = await JSZip.loadAsync(output)
      expect((await zip.file('xl/media/image1.png')!.async('uint8array')).byteLength).toBeGreaterThan(8)
      expect(rasterize).toHaveBeenCalledWith(blobUrl, 120, 80)
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
  })
})
