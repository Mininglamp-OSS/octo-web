/**
 * Image collection and batch fetching for DOCX export.
 * Collects image references from the document tree and fetches them as ArrayBuffers.
 */

import { resolveAttachments, type ResolvedAttachment } from '../../attachments/api.ts'
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
    if (!url && ref.src) url = ref.src
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
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15_000)
        try {
          const res = await fetch(url, { signal: controller.signal })
          clearTimeout(timeoutId)
          if (!res.ok) return
          const buffer = await res.arrayBuffer()
          imageBuffers.set(key, buffer)
        } catch {
          clearTimeout(timeoutId)
          // Timeout or network error — skip this image
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

  if (width && height) {
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
