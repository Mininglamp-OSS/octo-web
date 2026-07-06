/**
 * Image handling for PDF export.
 * Reuses the collection logic from docx/images.ts and fetches images as base64 data URLs.
 */

import { resolveAttachments, type ResolvedAttachment } from '../../attachments/api.ts'
import type { MdNode, ImageRef, PdfContext } from './types.ts'

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
 * Convert an ArrayBuffer to a base64 data URL.
 * Uses chunked String.fromCharCode to avoid GC pressure on large buffers.
 */
function arrayBufferToDataUrl(buffer: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  const base64 = btoa(binary)
  return `data:${mime};base64,${base64}`
}

/**
 * Guess MIME type from URL or default to image/png.
 */
function guessMimeType(url: string, resolved?: ResolvedAttachment): string {
  if (resolved?.mime) return resolved.mime
  const lower = url.toLowerCase()
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg'
  if (lower.includes('.gif')) return 'image/gif'
  if (lower.includes('.bmp')) return 'image/bmp'
  if (lower.includes('.webp')) return 'image/webp'
  return 'image/png'
}

/**
 * Resolve all attachment URLs and fetch images as base64 data URLs.
 * Returns the resolved URL map and image data map for the context.
 */
export async function resolveAndFetchImages(
  docId: string,
  doc: MdNode,
  options: {
    batchSize?: number
    resolve?: typeof resolveAttachments
  } = {},
): Promise<{ urls: Map<string, ResolvedAttachment>; imageData: Map<string, string> }> {
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
  const imageData = new Map<string, string>()

  // Build fetch queue
  const fetchQueue: Array<{ url: string; key: string; resolved?: ResolvedAttachment }> = []
  for (const ref of imageRefs) {
    let url: string | undefined
    let resolved: ResolvedAttachment | undefined
    if (ref.attachId) {
      resolved = urls.get(ref.attachId)
      if (resolved?.url) url = resolved.url
    }
    if (!url && ref.src) url = ref.src
    if (url) {
      const key = ref.attachId || url
      fetchQueue.push({ url, key, resolved })
    }
  }

  // Fetch with concurrency limit of 5
  const CONCURRENCY = 5
  for (let i = 0; i < fetchQueue.length; i += CONCURRENCY) {
    const batch = fetchQueue.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map(async ({ url, key, resolved }) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15_000)
        try {
          const res = await fetch(url, { signal: controller.signal })
          clearTimeout(timeoutId)
          if (!res.ok) return
          const buffer = await res.arrayBuffer()
          const mime = guessMimeType(url, resolved)
          const dataUrl = arrayBufferToDataUrl(buffer, mime)
          imageData.set(key, dataUrl)
        } catch {
          clearTimeout(timeoutId)
        }
      }),
    )
    void results
  }

  return { urls, imageData }
}

/**
 * Get the image data URL for a given node from the context.
 * Returns undefined if the image couldn't be fetched.
 */
export function getImageData(node: MdNode, ctx: PdfContext): string | undefined {
  const attachId = typeof node.attrs?.attachId === 'string' ? node.attrs.attachId : undefined
  const src = typeof node.attrs?.src === 'string' ? node.attrs.src : undefined

  if (attachId) {
    const data = ctx.imageData.get(attachId)
    if (data) return data
  }
  if (src) {
    return ctx.imageData.get(src)
  }
  return undefined
}

/**
 * Get image dimensions from node attrs or use defaults.
 * Caps width to content width.
 */
export function getImageDimensions(node: MdNode, maxWidth: number): { width: number; height: number } {
  const width = typeof node.attrs?.width === 'number' ? node.attrs.width : undefined
  const height = typeof node.attrs?.height === 'number' ? node.attrs.height : undefined

  if (width && height) {
    // Convert px to mm (approximate: 1px ≈ 0.264583mm at 96dpi)
    const pxToMm = 0.264583
    let w = width * pxToMm
    let h = height * pxToMm
    if (w > maxWidth) {
      const ratio = maxWidth / w
      w = maxWidth
      h = h * ratio
    }
    return { width: w, height: h }
  }

  // Default image size (in mm)
  return { width: Math.min(100, maxWidth), height: 75 }
}
