/**
 * Chinese font loading for PDF export.
 *
 * Strategy: detect if document contains Chinese characters, if so, fetch and
 * register the font with jsPDF before rendering.
 *
 * The font is imported via Vite's `?url` so the bundler resolves the correct
 * hashed asset path at build time — this avoids the 404s that plagued the
 * hardcoded /fonts/ path. A public-dir path and CDN act as fallbacks.
 */

import type { jsPDF } from 'jspdf'
// Vite resolves this to the correct built asset URL (with content hash).
import notoSansScUrl from './assets/NotoSansSC-Regular.ttf?url'

/** Bundler-resolved font URL (primary — always correct after build). */
const BUNDLED_FONT_URL = notoSansScUrl

/** Public-dir path (fallback if asset serving differs). */
const PUBLIC_FONT_PATH = '/fonts/NotoSansSC-Regular.ttf'

/** CDN fallback for Noto Sans SC. */
const CDN_FONT_URL =
  'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@latest/chinese-simplified-400-normal.ttf'

/** Custom font URL override (e.g., from a local asset server). */
let customFontUrl: string | undefined

/** Cached font data (once loaded, reuse across exports). null = not attempted, false = failed. */
let cachedFontData: string | null | false = null

/** Whether font is currently being loaded. */
let loading: Promise<string | false> | null = null

/**
 * Set a custom font URL (e.g., from a local asset server).
 * Must be called before export if self-hosting the font.
 */
export function setChineseFontUrl(url: string): void {
  customFontUrl = url
  // Invalidate cache if URL changes (allow retry with new URL)
  cachedFontData = null
  loading = null
}

/**
 * Detect if text contains CJK characters (Chinese/Japanese/Korean).
 * Checks a broader range including CJK Unified Ideographs and common punctuation.
 */
export function containsCJK(text: string): boolean {
  // CJK Unified Ideographs, CJK Compatibility Ideographs, CJK Extension A/B
  // Also includes common Chinese punctuation
  return /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u2E80-\u2EFF\u3000-\u303F\uFF00-\uFFEF]/.test(text)
}

/**
 * Detect if a ProseMirror document JSON contains Chinese text.
 * Walks the entire tree looking for CJK characters in text nodes.
 */
export function documentContainsCJK(doc: { content?: Array<{ text?: string; content?: unknown[] }> }): boolean {
  const walk = (node: Record<string, unknown>): boolean => {
    if (typeof node.text === 'string' && containsCJK(node.text)) return true
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        if (typeof child === 'object' && child !== null && walk(child as Record<string, unknown>)) return true
      }
    }
    return false
  }
  return walk(doc as Record<string, unknown>)
}

/**
 * Fetch the Chinese font file and return it as a base64 string.
 * Results are cached for subsequent exports in the same session.
 * Failure is also cached to avoid repeated failed requests.
 */
async function fetchFontData(): Promise<string | false> {
  // Return cached result (success or failure)
  if (cachedFontData !== null) return cachedFontData

  if (loading) return loading

  loading = (async () => {
    // Try bundled asset first (correct hashed path), then public dir, then CDN
    const urls = customFontUrl
      ? [customFontUrl]
      : [BUNDLED_FONT_URL, PUBLIC_FONT_PATH, CDN_FONT_URL]

    for (const url of urls) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10_000)
        const response = await fetch(url, { signal: controller.signal })
        clearTimeout(timeoutId)

        if (!response.ok) continue // try next URL

        const buffer = await response.arrayBuffer()
        const bytes = new Uint8Array(buffer)

        // Convert to base64 string (chunked to avoid stack overflow)
        let binary = ''
        const chunkSize = 8192
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, i + chunkSize)
          binary += String.fromCharCode(...chunk)
        }
        const base64 = btoa(binary)

        cachedFontData = base64
        return base64
      } catch {
        continue // try next URL
      }
    }

    console.warn('[pdf-export] All font sources failed (local + CDN)')
    cachedFontData = false
    return false
  })().finally(() => { loading = null })

  return loading
}

/**
 * Register the Chinese font with jsPDF instance.
 * Call this before rendering if CJK characters are detected.
 *
 * @returns true if font was successfully registered
 */
export async function registerChineseFont(pdf: jsPDF): Promise<boolean> {
  const fontData = await fetchFontData()
  if (!fontData) return false

  try {
    // Register font with jsPDF VFS
    pdf.addFileToVFS('NotoSansSC-Regular.ttf', fontData)
    pdf.addFont('NotoSansSC-Regular.ttf', 'NotoSansSC', 'normal')
    pdf.addFont('NotoSansSC-Regular.ttf', 'NotoSansSC', 'bold')
    pdf.addFont('NotoSansSC-Regular.ttf', 'NotoSansSC', 'italic')
    pdf.addFont('NotoSansSC-Regular.ttf', 'NotoSansSC', 'bolditalic')
    return true
  } catch (err) {
    console.warn('[pdf-export] Failed to register Chinese font:', err)
    return false
  }
}

/**
 * Get the appropriate font name based on whether Chinese font is available.
 * Use this instead of hardcoding 'helvetica' in renderers.
 */
export function getBodyFont(chineseFontLoaded: boolean): string {
  return chineseFontLoaded ? 'NotoSansSC' : 'helvetica'
}

/**
 * Get the appropriate monospace font name.
 * For code blocks, we still use courier (CJK in code is rare).
 */
export function getCodeFont(): string {
  return 'courier'
}
