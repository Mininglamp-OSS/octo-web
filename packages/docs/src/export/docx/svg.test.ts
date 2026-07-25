import { afterEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { exportDocToDocx } from './index.ts'
import type { MdNode } from './types.ts'

const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" style="fill:#ffff00"/></svg>'
const SVG_BYTES = new TextEncoder().encode(SVG_TEXT)
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x0a,
])

class TestImage {
  naturalWidth = 20
  naturalHeight = 10
  width = 20
  height = 10
  decoding = 'async'
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) { queueMicrotask(() => this.onload?.()) }
}

function doc(align: 'left' | 'center' | 'right' = 'right'): MdNode {
  return {
    type: 'doc',
    content: [{
      type: 'image',
      attrs: { attachId: 'att_svg', alt: 'architecture', width: 120, align },
    }],
  } as MdNode
}

async function exportSvg(mime = 'image/svg+xml') {
  vi.stubGlobal('Image', TestImage)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new Blob([PNG_BYTES], { type: 'image/png' }))
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(SVG_BYTES, {
    status: 200,
    headers: { 'content-type': mime, 'content-length': String(SVG_BYTES.byteLength) },
  })))
  const blob = await exportDocToDocx('doc_1', doc(), {
    resolve: async () => ({
      items: [{
        attachId: 'att_svg', mime, url: 'https://assets.test/diagram.svg',
        fileName: 'diagram.svg', sizeBytes: SVG_BYTES.byteLength, expiresInSec: 300,
      }],
      notFound: [],
    }),
  })
  return JSZip.loadAsync(await blob.arrayBuffer())
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('DOCX SVG export', () => {
  it('rasterizes SVG to genuine non-empty PNG media and emits a drawing with alt/alignment', async () => {
    const zip = await exportSvg()
    const mediaNames = Object.keys(zip.files).filter((name) => /^word\/media\/.*\.png$/i.test(name))
    expect(mediaNames).toHaveLength(1)
    const media = new Uint8Array(await zip.file(mediaNames[0])!.async('uint8array'))
    expect(media.byteLength).toBeGreaterThan(8)
    expect(Array.from(media.slice(0, 8))).toEqual(Array.from(PNG_BYTES.slice(0, 8)))
    expect(new TextDecoder().decode(media)).not.toContain('<svg')

    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('<w:drawing>')
    expect(xml).not.toContain('[SVG image: architecture]')
    expect(xml).toContain('descr="architecture"')
    expect(xml).toContain('<w:jc w:val="right"/>')
    // width=120 and intrinsic SVG ratio 2:1 should survive rasterization.
    expect(xml).toContain('cx="1143000"')
    expect(xml).toContain('cy="571500"')
  })

  it('sniffs and rasterizes SVG bytes even when attachment metadata says PNG', async () => {
    const zip = await exportSvg('image/png')
    const mediaNames = Object.keys(zip.files).filter((name) => /^word\/media\/[^/]+$/.test(name))
    expect(mediaNames).toHaveLength(1)
    const media = new Uint8Array(await zip.file(mediaNames[0])!.async('uint8array'))
    expect(Array.from(media.slice(0, 8))).toEqual(Array.from(PNG_BYTES.slice(0, 8)))
    expect(await zip.file('word/document.xml')!.async('string')).toContain('<w:drawing>')
  })
})
