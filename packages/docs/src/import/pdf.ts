// PDF → ProseMirror-JSON import.
//
// Primary path: Tagged PDF. Browser-produced PDFs (Chrome/Skia, wkhtmltopdf, LibreOffice,
// Word "save as tagged PDF", etc.) embed a logical structure tree — semantic roles such as
// H1..H6, P, Table/TR/TH/TD, L/LI, Code, BlockQuote — plus marked-content ids that link
// each structure leaf to its glyphs. We walk that tree and emit ProseMirror nodes directly
// from the semantic roles, which reconstructs tables, headings, lists, code, and quotes at
// full fidelity (no geometric guessing). Text color and bold are recovered from the glyph
// stream and reattached as marks.
//
// The output PM-JSON reuses the Markdown importer's shape and flows through the identical
// import pipeline (create doc → stash → EditorShell injects on mount).
//
// Scope (single approach, no fallback): native PDFs with a text layer. A PDF with no text
// layer (scanned / image-only) is rejected with PDF_NO_TEXT_LAYER (OCR is out of scope). A
// PDF with a text layer but no structure tree still imports, degrading to heading/paragraph
// inference from font metrics.
//
// Security: only plain text ever reaches text nodes; nothing is innerHTML-injected and no
// external resource is fetched.

import * as pdfjs from 'pdfjs-dist'
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api'
// Vite resolves this to a hashed asset URL; pdf.js runs its parser in this worker.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'
import type { PmNode, ImportResult } from './markdown.ts'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Thrown when a PDF carries no text layer (scanned / image-only). */
export const PDF_NO_TEXT_LAYER = 'PDF_NO_TEXT_LAYER'

/** Internal parse options (test seam for main-thread execution). */
export interface ParseOptions {
  /** Disable the pdf.js worker and run on the main thread (used by tests). */
  disableWorker?: boolean
}

/** A structure-tree node as returned by pdf.js getStructTree(). */
interface StructNode {
  role?: string
  type?: string
  id?: string
  children?: StructNode[]
  alt?: string
}

/** Per-glyph style pulled from the marked-content text stream, keyed by mcid. */
interface McStyle {
  text: string
  color: string
  bold: boolean
  maxSize: number
}

/**
 * Parse a PDF into a ProseMirror document. Pure w.r.t. the editor (no editor/network);
 * the caller creates the doc and injects `result.doc` after the editor loads.
 *
 * @throws Error(PDF_NO_TEXT_LAYER) when the PDF has no extractable text.
 */
export async function parsePdfToPmDoc(data: ArrayBuffer, opts: ParseOptions = {}): Promise<ImportResult> {
  const warnings: string[] = []

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(data),
    ...(opts.disableWorker ? { disableWorker: true } : {}),
  }).promise
  try {
    const out: PmNode[] = []
    let imageCount = 0
    let totalChars = 0
    let taggedPages = 0

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)

      // Build the mcid → styled-text map from the marked-content text stream.
      const styleMap = await buildMcStyleMap(page)
      for (const s of styleMap.values()) totalChars += countVisible(s.text)

      let tree: StructNode | null = null
      try {
        tree = (await page.getStructTree()) as unknown as StructNode | null
      } catch {
        tree = null
      }

      if (tree && hasContentLeaf(tree)) {
        taggedPages++
        emitFromStructTree(tree, styleMap, out)
      } else {
        // No structure tree on this page: degrade to font-metric inference.
        emitFromMetrics(styleMap, out)
      }

      imageCount += await countImages(page)
      page.cleanup()
    }

    if (totalChars < 10) throw new Error(PDF_NO_TEXT_LAYER)

    const merged = mergeAdjacentLists(out)
    if (imageCount > 0) {
      warnings.push(`${imageCount} 张图片未导入（PDF 导入暂不支持图片，仅还原文本结构）`)
    }
    if (taggedPages === 0) {
      warnings.push('该 PDF 无结构标签，已按字号推断标题与段落（表格结构可能无法还原）')
    }

    if (merged.length === 0) merged.push({ type: 'paragraph' })
    const title = firstHeadingText(merged)
    return { doc: { type: 'doc', content: merged }, title, warnings }
  } finally {
    void pdf.destroy()
  }
}

// ── Marked-content style map ────────────────────────────────────────────────
//
// pdf.js emits text items bracketed by beginMarkedContentProps{id} … endMarkedContent.
// Those ids match the `content` leaf ids in the structure tree. We accumulate each id's
// text plus its dominant color and bold flag (from the operator list's fill color and the
// font name), so the struct-tree walk can attach marks.

async function buildMcStyleMap(page: pdfjs.PDFPageProxy): Promise<Map<string, McStyle>> {
  const map = new Map<string, McStyle>()

  // Fill-color timeline aligned to showText ops, so each text run gets its active color.
  const showTextColors = await buildShowTextColors(page)

  const tc = await page.getTextContent({ includeMarkedContent: true })
  const idStack: string[] = []
  let showIdx = 0
  let untaggedKey = 0
  let lastSize = -1

  for (const raw of tc.items) {
    const it = raw as TextItem & TextMarkedContent
    if (it.type === 'beginMarkedContent' || it.type === 'beginMarkedContentProps') {
      idStack.push(it.id ?? '')
      continue
    }
    if (it.type === 'endMarkedContent') {
      idStack.pop()
      continue
    }
    if (typeof it.str !== 'string') continue
    const hasEol = (it as { hasEOL?: boolean }).hasEOL === true
    if (it.str.length === 0 && !hasEol) continue

    // Chrome/Skia wraps some CJK glyphs (rendered via radical/compatibility codepoints such
    // as U+2F00..U+2FDF or CJK-compat U+F900..U+FAFF) in a NESTED marked-content span that
    // carries no id. Bucketing those under an "untagged" key drops them from the structure
    // tree entirely. Inherit the nearest enclosing id so the glyph joins its parent leaf.
    const id = nearestId(idStack)
    const color = showTextColors[showIdx] ?? 'rgb(0,0,0)'
    if (it.str.length > 0) showIdx++
    const size = Number(it.height) || 12
    const bold = isBoldFont(it.fontName)
    // Preserve hard line breaks (needed for code blocks). Non-code roles collapse these to
    // spaces at emit time; code blocks keep them.
    const str = normalizeGlyphs(it.str) + (hasEol ? '\n' : '')
    // Untagged text (no marked-content id) is bucketed per contiguous same-size run so the
    // font-metric fallback can still see it and split headings from body.
    let key = id
    if (!key) {
      if (Math.abs(size - lastSize) > 0.5) untaggedKey++
      lastSize = size
      key = `__untagged_${untaggedKey}`
    }
    const prev = map.get(key)
    if (prev) {
      prev.text += str
      if (size > prev.maxSize) prev.maxSize = size
      if (bold) prev.bold = true
      if (!prev.color) prev.color = normColor(color)
    } else {
      map.set(key, { text: str, color: normColor(color), bold, maxSize: size })
    }
  }
  return map
}

/** Nearest non-empty id from the marked-content stack (innermost first). */
function nearestId(stack: string[]): string {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]) return stack[i]
  }
  return ''
}

/**
 * Normalize glyph codepoints that renderers substitute for CJK characters back to their
 * canonical forms so extracted text matches the source. Kangxi radicals (U+2F00..U+2FD5)
 * and CJK-compatibility ideographs (U+F900..U+FAFF) both decompose to their unified CJK
 * equivalents under NFKC, e.g. ⼊→入, ⾂→文, ⼀→一.
 */
function normalizeGlyphs(s: string): string {
  let hasCompat = false
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if ((cp >= 0x2f00 && cp <= 0x2fdf) || (cp >= 0xf900 && cp <= 0xfaff)) { hasCompat = true; break }
  }
  return hasCompat ? s.normalize('NFKC') : s
}

/** Sequence of active fill colors, one per showText op, in document order. */
async function buildShowTextColors(page: pdfjs.PDFPageProxy): Promise<string[]> {
  const ops = await page.getOperatorList()
  const { OPS } = pdfjs
  const colors: string[] = []
  let fill = 'rgb(0,0,0)'
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    if (fn === OPS.setFillRGBColor) {
      const a = ops.argsArray[i] as number[]
      fill = `rgb(${a.join(',')})`
    } else if (fn === OPS.showText) {
      colors.push(fill)
    }
  }
  return colors
}

// ── Structure-tree walk → ProseMirror ──────────────────────────────────────

const HEADING_ROLES: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 }

function hasContentLeaf(node: StructNode): boolean {
  if (node.type === 'content' && node.id) return true
  for (const c of node.children ?? []) if (hasContentLeaf(c)) return true
  return false
}

/** Concatenate all text under a struct node, in order. */
function textUnder(node: StructNode, styleMap: Map<string, McStyle>): string {
  if (node.type === 'content' && node.id) return styleMap.get(node.id)?.text ?? ''
  let s = ''
  for (const c of node.children ?? []) s += textUnder(c, styleMap)
  return s
}

/** Like textUnder, but skips the `exclude` subtree (used to drop an LI's Lbl marker). */
function textUnderExcluding(
  node: StructNode,
  exclude: StructNode | undefined,
  styleMap: Map<string, McStyle>,
): string {
  if (exclude && node === exclude) return ''
  if (node.type === 'content' && node.id) return styleMap.get(node.id)?.text ?? ''
  let s = ''
  for (const c of node.children ?? []) s += textUnderExcluding(c, exclude, styleMap)
  return s
}

/** Dominant non-default color across a struct node's content leaves (or ''). */
function colorUnder(node: StructNode, styleMap: Map<string, McStyle>): string {
  const counts = new Map<string, number>()
  const visit = (n: StructNode) => {
    if (n.type === 'content' && n.id) {
      const c = styleMap.get(n.id)?.color
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    for (const ch of n.children ?? []) visit(ch)
  }
  visit(node)
  if (counts.size !== 1) return '' // only tag when the whole node is one color
  return [...counts.keys()][0]
}

function inlineContent(text: string, color: string): PmNode[] {
  // Collapse hard line breaks + runs of whitespace to single spaces (prose flows; only code
  // blocks preserve newlines, and they bypass this helper).
  const t = text.replace(/\s+/gu, ' ').trim()
  if (!t) return []
  if (color) return [{ type: 'text', text: t, marks: [{ type: 'textStyle', attrs: { color } }] }]
  return [{ type: 'text', text: t }]
}

function findChildrenByRole(node: StructNode, roles: string[]): StructNode[] {
  const acc: StructNode[] = []
  const visit = (n: StructNode) => {
    if (n.role && roles.includes(n.role)) { acc.push(n); return }
    for (const c of n.children ?? []) visit(c)
  }
  for (const c of node.children ?? []) visit(c)
  return acc
}

function emitFromStructTree(tree: StructNode, styleMap: Map<string, McStyle>, out: PmNode[]): void {
  const walk = (node: StructNode) => {
    const role = node.role ?? ''

    if (role in HEADING_ROLES) {
      const text = textUnder(node, styleMap).trim()
      if (text) out.push({ type: 'heading', attrs: { level: HEADING_ROLES[role] }, content: inlineContent(text, colorUnder(node, styleMap)) })
      return
    }
    if (role === 'P') {
      const text = textUnder(node, styleMap).trim()
      if (text) out.push({ type: 'paragraph', content: inlineContent(text, colorUnder(node, styleMap)) })
      return
    }
    if (role === 'Table') {
      const table = buildTable(node, styleMap)
      if (table) out.push(table)
      return
    }
    if (role === 'L') {
      const list = buildList(node, styleMap)
      if (list) out.push(list)
      return
    }
    if (role === 'Code' || role === 'Pre') {
      // Preserve internal line breaks; trim only leading/trailing blank lines.
      const text = textUnder(node, styleMap).replace(/^\n+/u, '').replace(/\s+$/u, '')
      if (text.trim()) out.push({ type: 'codeBlock', content: [{ type: 'text', text }] })
      return
    }
    if (role === 'BlockQuote') {
      const text = textUnder(node, styleMap).trim()
      if (text) out.push({ type: 'blockquote', content: [{ type: 'paragraph', content: inlineContent(text, colorUnder(node, styleMap)) }] })
      return
    }
    if (role === 'Figure') return // images out of scope

    // Container/unknown role: descend.
    for (const c of node.children ?? []) walk(c)
  }
  for (const c of tree.children ?? []) walk(c)
}

function buildTable(node: StructNode, styleMap: Map<string, McStyle>): PmNode | null {
  const rows = findChildrenByRole(node, ['TR'])
  if (rows.length === 0) return null
  const tableRows: PmNode[] = []
  for (let ri = 0; ri < rows.length; ri++) {
    const cells = findChildrenByRole(rows[ri], ['TH', 'TD'])
    if (cells.length === 0) continue
    const cellNodes: PmNode[] = cells.map((cell) => {
      const isHeader = cell.role === 'TH'
      const text = textUnder(cell, styleMap).trim()
      const color = colorUnder(cell, styleMap)
      return {
        type: isHeader ? 'tableHeader' : 'tableCell',
        content: [{ type: 'paragraph', content: inlineContent(text, color) }],
      }
    })
    tableRows.push({ type: 'tableRow', content: cellNodes })
  }
  if (tableRows.length === 0) return null
  return { type: 'table', content: tableRows }
}

function buildList(node: StructNode, styleMap: Map<string, McStyle>): PmNode | null {
  const items = findChildrenByRole(node, ['LI'])
  if (items.length === 0) return null
  // Ordered when the list body labels are numeric; else bullet.
  let ordered = false
  let start: number | undefined
  const liNodes: PmNode[] = []
  for (const li of items) {
    // LI → optional Lbl (marker) + LBody (content). Some producers (e.g. Chrome) omit the
    // LBody wrapper and put content in a bare NonStruct sibling of Lbl; in that case read the
    // LI's text while excluding the Lbl subtree so the marker glyph ("1.") never leaks in.
    const lbl = findChildrenByRole(li, ['Lbl'])[0]
    const bodyNode = findChildrenByRole(li, ['LBody'])[0]
    const label = lbl ? textUnder(lbl, styleMap).trim() : ''
    const m = label.match(/^(\d{1,3})[.)、]?$/u)
    if (m) {
      ordered = true
      if (start == null) start = Number(m[1])
    }
    const text = (bodyNode ? textUnder(bodyNode, styleMap) : textUnderExcluding(li, lbl, styleMap)).trim()
    const colorSrc = bodyNode ?? li
    liNodes.push({ type: 'listItem', content: [{ type: 'paragraph', content: inlineContent(text, colorUnder(colorSrc, styleMap)) }] })
  }
  if (liNodes.length === 0) return null
  if (ordered) {
    const attrs = start != null && start !== 1 ? { start } : undefined
    return { type: 'orderedList', ...(attrs ? { attrs } : {}), content: liNodes }
  }
  return { type: 'bulletList', content: liNodes }
}

// ── Font-metric fallback (untagged pages) ────────────────────────────────────

function emitFromMetrics(styleMap: Map<string, McStyle>, out: PmNode[]): void {
  // Each mcid is a text run; treat runs as lines and infer heading vs paragraph by size.
  const runs = [...styleMap.values()].filter((s) => s.text.trim())
  if (runs.length === 0) return
  const sizes = runs.map((r) => r.maxSize)
  const body = mode(sizes) || 12
  for (const r of runs) {
    const ratio = r.maxSize / body
    const text = r.text.trim()
    if (ratio >= 1.4) out.push({ type: 'heading', attrs: { level: ratio >= 1.8 ? 1 : 2 }, content: inlineContent(text, r.color) })
    else if (r.bold && ratio >= 1.1 && text.length <= 40) out.push({ type: 'heading', attrs: { level: 3 }, content: inlineContent(text, r.color) })
    else out.push({ type: 'paragraph', content: inlineContent(text, r.color) })
  }
}

// ── Post-processing ──────────────────────────────────────────────────────────

/**
 * Merge consecutive lists of the same type into one. Tagged PDFs split a single list into
 * one `L` per page at page breaks, so an ordered list crossing a page boundary arrives as
 * several `orderedList` nodes (the continuation carries a `start` attr). Concatenate their
 * items and keep the FIRST fragment's start so the numbering stays continuous.
 */
function mergeAdjacentLists(nodes: PmNode[]): PmNode[] {
  const out: PmNode[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (prev && (n.type === 'bulletList' || n.type === 'orderedList') && prev.type === n.type) {
      prev.content = [...(prev.content ?? []), ...(n.content ?? [])]
    } else {
      out.push(n)
    }
  }
  return out
}

// ── Images ────────────────────────────────────────────────────────────────────

async function countImages(page: pdfjs.PDFPageProxy): Promise<number> {
  try {
    const ops = await page.getOperatorList()
    let n = 0
    const { OPS } = pdfjs
    for (const fn of ops.fnArray) {
      if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) n++
    }
    return n
  } catch {
    return 0
  }
}

// ── Small helpers ───────────────────────────────────────────────────────────

function normColor(c: string): string {
  const m = c.match(/rgb\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\)/)
  if (!m) return ''
  const [r, g, b] = [Math.round(Number(m[1])), Math.round(Number(m[2])), Math.round(Number(m[3]))]
  if (r <= 40 && g <= 45 && b <= 50) return '' // body near-black → default
  return `#${hex(r)}${hex(g)}${hex(b)}`
}
function hex(n: number): string { return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0') }

function isBoldFont(fontName: string | undefined): boolean {
  if (!fontName) return false
  return /bold|black|heavy|semibold|[-_]bd\b/i.test(fontName)
}

function firstHeadingText(nodes: PmNode[]): string | null {
  for (const n of nodes) {
    if (n.type === 'heading' && (n.attrs?.level ?? 1) === 1) {
      const txt = (n.content ?? []).map((c) => c.text ?? '').join('').trim()
      if (txt) return txt
    }
  }
  for (const n of nodes) {
    if (n.type === 'heading') {
      const txt = (n.content ?? []).map((c) => c.text ?? '').join('').trim()
      if (txt) return txt
    }
  }
  return null
}

function mode(nums: number[]): number {
  const freq = new Map<number, number>()
  for (const n of nums) freq.set(n, (freq.get(n) ?? 0) + 1)
  let best = 0
  let bestCount = -1
  for (const [v, c] of freq) if (c > bestCount) { best = v; bestCount = c }
  return best
}

function countVisible(s: string): number { return s.replace(/\s+/gu, '').length }
