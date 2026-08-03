/**
 * Image collection and batch fetching for DOCX export.
 * Collects image references from the document tree and fetches them as ArrayBuffers.
 */

import { resolveAttachments, type ResolvedAttachment } from '../../attachments/api.ts'
import { sanitizeAssetUrl } from '../../editor/sanitize.ts'
import { rasterizeSvgToPng } from '../imageRasterize.ts'
import type { MdNode, ImageRef, DocxContext } from './types.ts'

/**
 * Collect all image references (attachIds and direct src URLs) from the document tree.
 */
export function collectImageRefs(doc: MdNode): ImageRef[] {
  const refs: ImageRef[] = []
  const seen = new Set<string>()

  const walk = (node: MdNode) => {
    if (node.type === 'image') {
      const attachId = typeof node.attrs?.attachId === 'string' ? node.attrs.attachId : undefined
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : undefined
      const key = attachId || src || ''
      if (key && !seen.has(key)) {
        seen.add(key)
        refs.push({ attachId, src })
      }
    }
    node.content?.forEach(walk)
  }
  walk(doc)
  return refs
}

/**
 * Collect all unique attachIds from the document (images + fileAttachments).
 */
export function collectAttachIds(doc: MdNode): string[] {
  const ids = new Set<string>()
  const walk = (node: MdNode) => {
    if (node.type === 'image' || node.type === 'fileAttachment') {
      const id = node.attrs?.attachId
      if (typeof id === 'string' && id) ids.add(id)
    }
    node.content?.forEach(walk)
  }
  walk(doc)
  return [...ids]
}

/** Chunk an array into smaller arrays of the given size. */
function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Resolve all attachment URLs and fetch image buffers.
 * Returns the resolved URL map and image buffer map for the context.
 */
export async function resolveAndFetchImages(
  docId: string,
  doc: MdNode,
  options: {
    batchSize?: number
    resolve?: typeof resolveAttachments
  } = {},
): Promise<{ urls: Map<string, ResolvedAttachment>; imageBuffers: Map<string, ArrayBuffer> }> {
  const batchSize = options.batchSize ?? 200
  const resolve = options.resolve ?? resolveAttachments

  // Step 1: resolve all attach IDs to get signed URLs
  const ids = collectAttachIds(doc)
  const urls = new Map<string, ResolvedAttachment>()
  for (const idChunk of chunk(ids, batchSize)) {
    if (idChunk.length === 0) continue
    const res = await resolve(docId, idChunk)
    for (const item of res.items) urls.set(item.attachId, item)
  }

  // Step 2: collect image refs and determine which URLs to fetch
  const imageRefs = collectImageRefs(doc)
  const imageBuffers = new Map<string, ArrayBuffer>()

  // Fetch images in parallel (with concurrency limit)
  const fetchQueue: Array<{ url: string; key: string }> = []
  for (const ref of imageRefs) {
    let url: string | undefined
    if (ref.attachId) {
      const resolved = urls.get(ref.attachId)
      if (resolved?.url) url = resolved.url
    }
    if (!url && ref.src) {
      // Gate raw src through the same trust boundary the editor enforces everywhere
      // else (ImageNode/ImageNodeView -> sanitizeAssetUrl): scheme + storage-host
      // allowlist. A scheme-only check here would let a document embed
      // src="http://169.254.169.254/..." or an internal RFC1918 host and make the
      // exporting user's browser fire a blind SSRF beacon from their authed session.
      //
      // data: URLs have no network egress (no SSRF) and are the legitimate inline
      // image case, so they are allowed directly. http(s) must pass the host
      // allowlist; anything else (file:, javascript:, blob:, cross-origin, UNC) is
      // silently omitted — the resolved-attachment happy path covers the real embed.
      if (/^data:/i.test(ref.src)) {
        url = ref.src
      } else {
        const safe = sanitizeAssetUrl(ref.src)
        if (safe) url = safe
      }
    }
    if (url) {
      const key = ref.attachId || url
      fetchQueue.push({ url, key })
    }
  }

  // Fetch with concurrency limit of 5
  const CONCURRENCY = 5
  for (let i = 0; i < fetchQueue.length; i += CONCURRENCY) {
    const batch = fetchQueue.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async ({ url, key }) => {
        const MAX_BYTES = 10 * 1024 * 1024
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15_000)
        try {
          const res = await fetch(url, { signal: controller.signal })
          if (!res.ok) return
          // Reject early on an honest content-length over the cap.
          const contentLength = Number(res.headers.get('content-length')) || 0
          if (contentLength > MAX_BYTES) return
          // Stream the body and enforce the cap on accumulated bytes so a
          // missing/spoofed content-length cannot force an unbounded
          // allocation. The abort controller stays live through the whole
          // body read, so a stalled/dribbling host still frees its pool slot.
          const reader = res.body?.getReader()
          if (!reader) {
            // No stream reader (e.g. data: URL) — fall back to a guarded read.
            const buffer = await res.arrayBuffer()
            if (buffer.byteLength > MAX_BYTES) return
            imageBuffers.set(key, buffer)
            return
          }
          const chunks: Uint8Array[] = []
          let total = 0
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
              total += value.byteLength
              if (total > MAX_BYTES) {
                controller.abort()
                return
              }
              chunks.push(value)
            }
          }
          const merged = new Uint8Array(total)
          let offset = 0
          for (const chunk of chunks) {
            merged.set(chunk, offset)
            offset += chunk.byteLength
          }
          imageBuffers.set(key, merged.buffer)
        } catch {
          // Timeout, abort, or network error — skip this image
        } finally {
          clearTimeout(timeoutId)
        }
      }),
    )
    // Silently skip failed image fetches — the export continues without them
    void results
  }

  return { urls, imageBuffers }
}

/** Detect SVG from bytes even when attachment metadata is absent or incorrect. */
export function isSvgBuffer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024))
  const prefix = new TextDecoder().decode(bytes)
  return /^\uFEFF?\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(prefix)
}

/**
 * Replace fetched SVG buffers with genuine browser-rasterized PNG buffers before
 * the synchronous ProseMirror → docx conversion starts. This keeps the existing
 * converter synchronous (including table recursion) while allowing ImageRun to
 * receive only formats Word reliably supports.
 */
export async function rasterizeSvgImageBuffers(
  doc: MdNode,
  urls: Map<string, ResolvedAttachment>,
  imageBuffers: Map<string, ArrayBuffer>,
): Promise<void> {
  const tasks: Promise<void>[] = []
  for (const ref of collectImageRefs(doc)) {
    const key = ref.attachId || ref.src
    if (!key) continue
    const buffer = imageBuffers.get(key)
    if (!buffer) continue
    const mime = ref.attachId ? urls.get(ref.attachId)?.mime?.toLowerCase() ?? '' : ''
    if (!mime.includes('svg') && !isSvgBuffer(buffer)) continue
    tasks.push((async () => {
      try {
        const png = await rasterizeSvgToPng(new Blob([buffer], { type: 'image/svg+xml' }))
        imageBuffers.set(key, await png.arrayBuffer())
      } catch (error) {
        // Keep the original SVG so convertImage emits its safe alt-text fallback
        // rather than embedding unsupported or mislabeled bytes.
        console.warn('[docx-export] failed to rasterize SVG image:', error)
      }
    })())
  }
  await Promise.all(tasks)
}

/**
 * Get the image buffer for a given node from the context.
 * Returns undefined if the image couldn't be fetched.
 */
export function getImageBuffer(node: MdNode, ctx: DocxContext): ArrayBuffer | undefined {
  const attachId = typeof node.attrs?.attachId === 'string' ? node.attrs.attachId : undefined
  const src = typeof node.attrs?.src === 'string' ? node.attrs.src : undefined

  if (attachId) {
    const buffer = ctx.imageBuffers.get(attachId)
    if (buffer) return buffer
  }
  if (src) {
    return ctx.imageBuffers.get(src)
  }
  return undefined
}

/** Max rendered image width (px) — keeps images inside the A4 content column. */
const MAX_IMAGE_WIDTH = 600
/** Fallback box only used when neither attrs nor the bytes yield a real size. */
const DEFAULT_IMAGE = { width: 400, height: 300 }

/**
 * Read the intrinsic pixel dimensions from an encoded image's header bytes.
 * Supports PNG, JPEG, GIF and BMP (the four types the exporter emits). Returns
 * undefined when the bytes are too short or the format is unrecognized.
 *
 * The editor's ImageNode only persists `width` (resize is width-only, height is
 * CSS `height:auto` in the browser), so the true aspect ratio is not in the
 * document model — it must come from the image itself. Without this the export
 * fell back to a fixed 400x300 box and squished every non-4:3 image flat.
 */
export function readIntrinsicSize(
  buffer: ArrayBuffer,
): { width: number; height: number } | undefined {
  const b = new Uint8Array(buffer)
  if (b.length < 4) return undefined

  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR width/height are big-endian at bytes 16..23.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    if (b.length < 24) return undefined
    const dv = new DataView(buffer)
    const w = dv.getUint32(16, false)
    const h = dv.getUint32(20, false)
    if (w > 0 && h > 0) return { width: w, height: h }
    return undefined
  }

  // GIF: 'GIF', logical screen width/height are little-endian at bytes 6..9.
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    if (b.length < 10) return undefined
    const dv = new DataView(buffer)
    const w = dv.getUint16(6, true)
    const h = dv.getUint16(8, true)
    if (w > 0 && h > 0) return { width: w, height: h }
    return undefined
  }

  // BMP: 'BM', BITMAPINFOHEADER width/height are little-endian int32 at bytes 18..25.
  if (b[0] === 0x42 && b[1] === 0x4d) {
    if (b.length < 26) return undefined
    const dv = new DataView(buffer)
    const w = dv.getInt32(18, true)
    const h = Math.abs(dv.getInt32(22, true)) // height may be negative (top-down)
    if (w > 0 && h > 0) return { width: w, height: h }
    return undefined
  }

  // JPEG: FF D8, then walk marker segments to the SOF (start-of-frame) which
  // carries height/width as big-endian uint16 at offsets +5 and +7 from the marker.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2
    const dv = new DataView(buffer)
    while (offset + 9 < b.length) {
      if (b[offset] !== 0xff) {
        offset++
        continue
      }
      const marker = b[offset + 1]
      // Standalone markers (no length): padding 0xFF, RSTn, TEM, EOI.
      if (marker === 0xff) {
        offset++
        continue
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }
      const segLen = dv.getUint16(offset + 2, false)
      if (segLen < 2) return undefined
      // SOF0..SOF15 except DHT(C4)/DAC(CC)/RSTn — these carry frame dimensions.
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      if (isSof) {
        if (offset + 9 >= b.length) return undefined
        const h = dv.getUint16(offset + 5, false)
        const w = dv.getUint16(offset + 7, false)
        if (w > 0 && h > 0) return { width: w, height: h }
        return undefined
      }
      offset += 2 + segLen
    }
    return undefined
  }

  return undefined
}

/**
 * Compute the DOCX render dimensions for an image, preserving aspect ratio.
 *
 * Priority for the shape (aspect ratio): the image's intrinsic bytes, since the
 * editor never stores height. The stored `width` attr (if any) sets the target
 * display width; otherwise the intrinsic width is used. Result width is capped
 * at MAX_IMAGE_WIDTH and height is always derived from the true ratio so nothing
 * gets stretched or flattened.
 */
export function getImageDimensions(
  node: MdNode,
  buffer?: ArrayBuffer,
  maxWidthPx?: number,
): { width: number; height: number } {
  const attrWidth =
    typeof node.attrs?.width === 'number' && Number.isFinite(node.attrs.width) && node.attrs.width > 0
      ? node.attrs.width
      : undefined
  const attrHeight =
    typeof node.attrs?.height === 'number' &&
    Number.isFinite(node.attrs.height) &&
    node.attrs.height > 0
      ? node.attrs.height
      : undefined

  const intrinsic = buffer ? readIntrinsicSize(buffer) : undefined

  // Aspect ratio (height / width). Prefer intrinsic bytes; fall back to an
  // explicit attr pair if both are present; otherwise the default box shape.
  let ratio: number | undefined
  if (intrinsic) ratio = intrinsic.height / intrinsic.width
  else if (attrWidth && attrHeight) ratio = attrHeight / attrWidth

  // Effective width cap: the page-wide default, further tightened to the current
  // container (e.g. a table cell) when a bound is supplied. Nested tables shrink
  // the cell well below the page width, so without this an image keeps its
  // page-scale width and overflows the cell.
  const widthCap =
    typeof maxWidthPx === 'number' && Number.isFinite(maxWidthPx) && maxWidthPx > 0
      ? Math.min(MAX_IMAGE_WIDTH, maxWidthPx)
      : MAX_IMAGE_WIDTH

  // Target display width: stored attr, else intrinsic, else default.
  let width = attrWidth ?? intrinsic?.width ?? DEFAULT_IMAGE.width
  if (width > widthCap) width = widthCap

  // If we still have no real ratio, fall back to the legacy default box so we
  // never emit a zero/NaN dimension.
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) {
    // Keep the default box aspect, but always honour the width cap so an image
    // whose bytes we can't sniff (e.g. SVG/WebP, which readIntrinsicSize does
    // not parse) and that carries no explicit width can't render at the full
    // 400px default and overflow a narrow nested cell.
    const defRatio = DEFAULT_IMAGE.height / DEFAULT_IMAGE.width
    const boxWidth = attrWidth ? width : Math.min(DEFAULT_IMAGE.width, widthCap)
    return { width: Math.round(boxWidth), height: Math.max(1, Math.round(boxWidth * defRatio)) }
  }

  return { width: Math.round(width), height: Math.max(1, Math.round(width * ratio)) }
}
