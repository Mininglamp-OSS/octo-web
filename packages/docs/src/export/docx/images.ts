/**
 * Image collection and batch fetching for DOCX export.
 * Collects image references from the document tree and fetches them as ArrayBuffers.
 */

import { resolveAttachments, type ResolvedAttachment } from '../../attachments/api.ts'
import { sanitizeAssetUrl } from '../../editor/sanitize.ts'
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

/**
 * Guess image dimensions from node attrs or use defaults.
 */
export function getImageDimensions(node: MdNode): { width: number; height: number } {
  const width = typeof node.attrs?.width === 'number' ? node.attrs.width : undefined
  const height = typeof node.attrs?.height === 'number' ? node.attrs.height : undefined

  // Only accept strictly positive, finite dimensions; anything else
  // (negative, zero, NaN, Infinity) falls back to the default size.
  if (
    width &&
    height &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    // Cap width at 600px for DOCX page width
    const maxWidth = 600
    if (width > maxWidth) {
      const ratio = maxWidth / width
      return { width: maxWidth, height: Math.round(height * ratio) }
    }
    return { width, height }
  }

  // Default image size
  return { width: 400, height: 300 }
}
