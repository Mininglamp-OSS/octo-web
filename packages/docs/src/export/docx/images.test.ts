/**
 * SSRF-gating tests for the DOCX image collector.
 *
 * Raw image `src` values must pass through the same trust boundary the editor
 * enforces everywhere else (sanitizeAssetUrl: scheme + storage-host allowlist).
 * A scheme-only check would let a document embed src="http://169.254.169.254/…"
 * or an internal RFC1918 host and make the exporting user's browser fire a blind
 * SSRF beacon from their authenticated session. data: URLs have no network
 * egress and remain the legitimate inline-image case.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveAndFetchImages, readIntrinsicSize, getImageDimensions } from './images.ts'
import type { MdNode } from './types.ts'
import type { resolveAttachments } from '../../attachments/api.ts'

const noopResolve: typeof resolveAttachments = async () => ({ items: [], notFound: [] })

function imageDoc(src: string): MdNode {
  return { type: 'doc', content: [{ type: 'image', attrs: { src } }] } as MdNode
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveAndFetchImages — raw src SSRF gating', () => {
  it('does NOT fetch a non-allowlisted http host (internal/SSRF target)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
    )
    await resolveAndFetchImages('d1', imageDoc('http://169.254.169.254/latest/meta-data'), {
      resolve: noopResolve,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does NOT fetch an arbitrary external host lacking allowlist entry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
    )
    await resolveAndFetchImages('d1', imageDoc('https://evil.attacker.example/x.png'), {
      resolve: noopResolve,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('DOES fetch an allowlisted storage host', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
    )
    await resolveAndFetchImages('d1', imageDoc('https://assets.octo.example.com/img.png'), {
      resolve: noopResolve,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toContain('assets.octo.example.com')
  })

  it('DOES fetch a data: image (no network egress, inline case)', async () => {
    // data: still goes through the guarded fetch path; jsdom/undici handles data URLs.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
    )
    await resolveAndFetchImages(
      'd1',
      imageDoc('data:image/png;base64,iVBORw0KGgo='),
      { resolve: noopResolve },
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toMatch(/^data:image\/png/)
  })

  it('does NOT fetch file:/blob:/javascript: schemes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200 }),
    )
    for (const bad of ['file:///etc/passwd', 'blob:https://x/y', 'javascript:alert(1)']) {
      await resolveAndFetchImages('d1', imageDoc(bad), { resolve: noopResolve })
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// --- Intrinsic dimension parsing ---------------------------------------------

/** Build a minimal PNG buffer with the given IHDR width/height. */
function pngOf(w: number, h: number): ArrayBuffer {
  const buf = new Uint8Array(24)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const dv = new DataView(buf.buffer)
  dv.setUint32(16, w, false)
  dv.setUint32(20, h, false)
  return buf.buffer
}

/** Build a minimal GIF87a/89a header with the given logical screen size. */
function gifOf(w: number, h: number): ArrayBuffer {
  const buf = new Uint8Array(10)
  buf.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0) // 'GIF89a'
  const dv = new DataView(buf.buffer)
  dv.setUint16(6, w, true)
  dv.setUint16(8, h, true)
  return buf.buffer
}

/** Build a minimal BMP with BITMAPINFOHEADER width/height. */
function bmpOf(w: number, h: number): ArrayBuffer {
  const buf = new Uint8Array(26)
  buf.set([0x42, 0x4d], 0) // 'BM'
  const dv = new DataView(buf.buffer)
  dv.setInt32(18, w, true)
  dv.setInt32(22, h, true)
  return buf.buffer
}

/** Build a minimal JPEG: SOI + a SOF0 segment carrying height/width. */
function jpegOf(w: number, h: number): ArrayBuffer {
  // FFD8 (SOI) | FFC0 (SOF0) | len=0x0011 | prec | height | width | ...
  const buf = new Uint8Array(20)
  const dv = new DataView(buf.buffer)
  buf[0] = 0xff
  buf[1] = 0xd8
  buf[2] = 0xff
  buf[3] = 0xc0
  dv.setUint16(4, 0x0011, false) // segment length
  buf[6] = 8 // sample precision
  dv.setUint16(7, h, false) // height at marker+5
  dv.setUint16(9, w, false) // width at marker+7
  return buf.buffer
}

describe('readIntrinsicSize', () => {
  it('reads PNG IHDR dimensions', () => {
    expect(readIntrinsicSize(pngOf(1920, 1080))).toEqual({ width: 1920, height: 1080 })
  })
  it('reads GIF logical screen dimensions', () => {
    expect(readIntrinsicSize(gifOf(320, 240))).toEqual({ width: 320, height: 240 })
  })
  it('reads BMP header dimensions (abs height for top-down)', () => {
    expect(readIntrinsicSize(bmpOf(800, -600))).toEqual({ width: 800, height: 600 })
  })
  it('reads JPEG SOF0 dimensions', () => {
    expect(readIntrinsicSize(jpegOf(1024, 768))).toEqual({ width: 1024, height: 768 })
  })
  it('returns undefined for unrecognized/short bytes', () => {
    expect(readIntrinsicSize(new Uint8Array([0x00, 0x01]).buffer)).toBeUndefined()
    expect(readIntrinsicSize(new Uint8Array([0x12, 0x34, 0x56, 0x78]).buffer)).toBeUndefined()
  })
})

describe('getImageDimensions — aspect ratio preservation', () => {
  const img = (attrs: Record<string, unknown> = {}): MdNode =>
    ({ type: 'image', attrs }) as MdNode

  it('derives height from intrinsic ratio when no width attr (under cap)', () => {
    // 16:9 image under the 600 cap -> use intrinsic size as-is
    expect(getImageDimensions(img(), pngOf(480, 270))).toEqual({ width: 480, height: 270 })
  })

  it('caps intrinsic width over 600 while keeping ratio', () => {
    // 16:9 image at 1600 wide -> capped to 600, height 338 (ratio preserved)
    expect(getImageDimensions(img(), pngOf(1600, 900))).toEqual({ width: 600, height: 338 })
  })

  it('scales height to the true ratio when width attr is set', () => {
    // stored width 300, intrinsic 1600x900 (ratio 0.5625) -> height 169
    expect(getImageDimensions(img({ width: 300 }), pngOf(1600, 900))).toEqual({
      width: 300,
      height: 169,
    })
  })

  it('caps width at 600 and keeps the ratio (no flattening)', () => {
    // intrinsic 4000x1000 (4:1), no width attr -> cap 600, height 150
    expect(getImageDimensions(img(), pngOf(4000, 1000))).toEqual({ width: 600, height: 150 })
  })

  it('does NOT force a 4:3 box for a tall image (regression: “扁了”)', () => {
    // Portrait 600x1200 (1:2). Old code fell back to 400x300 (landscape) and
    // squished it flat; now height must exceed width.
    const d = getImageDimensions(img(), pngOf(600, 1200))
    expect(d.height).toBeGreaterThan(d.width)
    expect(d).toEqual({ width: 600, height: 1200 })
  })

  it('falls back to default box when buffer is undefined and no attrs', () => {
    expect(getImageDimensions(img())).toEqual({ width: 400, height: 300 })
  })

  it('uses attr width+height ratio when buffer unreadable', () => {
    // no buffer, but both attrs present -> derive from attr ratio
    expect(getImageDimensions(img({ width: 200, height: 100 }))).toEqual({
      width: 200,
      height: 100,
    })
  })
})
