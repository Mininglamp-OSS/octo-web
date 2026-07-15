// Whitelist HTML → ProseMirror node/mark reverse mapping for Markdown import.
//
// The exporter (../export/markdown.ts) emits inline HTML for nodes/marks that Markdown
// can't express natively: <u>, <mark>, <sub>, <sup>, <span style="color:…">, and block-level
// <div data-callout>, <details>, and <table> with colspan/rowspan. This module parses those
// specific patterns back into PM JSON. Unknown/unhandled HTML is NEVER innerHTML-injected;
// it degrades to plain text (security line inherited from PDF-export lessons).
//
// Security:
//   - isSafeHref: scheme whitelist http/https/mailto/tel + relative. Blocks javascript:/data:/
//     vbscript: and tab/newline bypass variants.
//   - isSafeCssColor: #hex / rgb(a) / hsl(a) / named CSS colors only. Rejects anything with
//     `;`, `(`, `)` outside known function syntax, or unknown tokens (blocks declaration injection).
//   - parseInlineHtml / parseHtmlBlock: only recognize the exact tags the exporter emits.

import type { PmNode } from './markdown.ts'

// ── URL safety ────────────────────────────────────────────────────────────────

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * Return the href if it passes the scheme whitelist, or null.
 * Relative URLs are accepted (resolved against about:blank — caller decides).
 * Blocks javascript:, data:, vbscript:, and control-char bypass variants.
 */
export function isSafeHref(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Strip control characters that can hide protocol boundaries (tab, newline, etc.)
  const cleaned = raw.replace(/[\x00-\x20]/g, '').toLowerCase()
  // Check for known-dangerous prefixes before URL parsing (defense in depth)
  if (/^(javascript|data|vbscript):/i.test(cleaned)) return null
  try {
    const u = new URL(raw, 'https://safe.local/')
    if (SAFE_SCHEMES.has(u.protocol)) return u.href
    // Relative URL (parsed against our dummy base) — accept if no scheme was intended
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw.trim())) return raw
    return null
  } catch {
    return null
  }
}

// ── CSS color safety ──────────────────────────────────────────────────────────

// Named CSS colors subset (common ones the editor might produce). Full list not needed;
// unrecognized names just fail the regex and get dropped.
const NAMED_COLORS = new Set([
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink',
  'brown', 'gray', 'grey', 'cyan', 'magenta', 'lime', 'navy', 'teal', 'maroon',
  'olive', 'silver', 'fuchsia', 'aqua', 'coral', 'salmon', 'tomato', 'gold',
  'khaki', 'plum', 'orchid', 'sienna', 'peru', 'tan', 'wheat', 'linen', 'beige',
  'ivory', 'snow', 'azure', 'mintcream', 'honeydew', 'aliceblue', 'ghostwhite',
  'lavender', 'mistyrose', 'antiquewhite', 'floralwhite', 'seashell', 'oldlace',
  'papayawhip', 'blanchedalmond', 'bisque', 'moccasin', 'navajowhite', 'peachpuff',
  'palegoldenrod', 'lemonchiffon', 'lightyellow', 'lightgoldenrodyellow',
  'cornsilk', 'darkred', 'darkgreen', 'darkblue', 'darkcyan', 'darkmagenta',
  'darkorange', 'darkviolet', 'darkgoldenrod', 'darkolivegreen', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise',
  'deepskyblue', 'dodgerblue', 'firebrick', 'forestgreen', 'hotpink',
  'indianred', 'lawngreen', 'lightblue', 'lightcoral', 'lightcyan',
  'lightgreen', 'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue',
  'lightslategray', 'lightsteelblue', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen',
  'mediumturquoise', 'midnightblue', 'olivedrab', 'orangered', 'palegreen',
  'paleturquoise', 'palevioletred', 'powderblue', 'royalblue', 'saddlebrown',
  'sandybrown', 'seagreen', 'skyblue', 'slateblue', 'slategray', 'springgreen',
  'steelblue', 'yellowgreen', 'rebeccapurple', 'crimson', 'chocolate',
])

/**
 * Validate a CSS color value. Accepts #hex, rgb()/rgba(), hsl()/hsla(), and named colors.
 * Returns the original value if safe, null if suspicious (contains `;`, extra parens, etc.).
 */
export function isSafeCssColor(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (!v) return null

  // Block any semicolon, colon, or parentheses outside known function syntax
  // (prevents `red;position:fixed` or `red;background:url(...)` injection).

  // #hex: 3, 4, 6, or 8 hex digits
  if (/^#[0-9a-f]{3,8}$/.test(v)) return raw.trim()

  // rgb()/rgba()/hsl()/hsla(): allow only digits, commas, dots, spaces, %, and one pair of parens
  if (/^(rgb|rgba|hsl|hsla)\(\s*[\d.,%\s]+\)$/.test(v)) return raw.trim()

  // Named color
  if (NAMED_COLORS.has(v)) return raw.trim()

  return null
}

/**
 * Validate a CSS font-size value so it can be safely placed on a textStyle mark.
 * Accepts a number followed by a known length/relative unit (px, pt, em, rem, %),
 * mirroring what the exporter emits (`font-size:24px`). Rejects anything with extra
 * declarations, functions, or characters that could break out of the attribute.
 * Returns the normalized value (trimmed original) or null when unsafe.
 */
export function isSafeFontSize(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim()
  if (!v) return null
  // number (int or decimal) + unit; no semicolons/colons/parens or other declarations.
  if (/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/i.test(v)) return v
  return null
}

/**
 * Whitelist a block `align` attribute value to the alignments the editor's
 * paragraph/heading `textAlign` attr supports. Any other value (including a
 * quote-escaped injection attempt) yields null so it is never written onto the
 * node. `left` is the default and carries no explicit alignment.
 */
function sanitizeAlign(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  return v === 'center' || v === 'right' || v === 'justify' ? v : null
}

// ── Inline HTML parsing ───────────────────────────────────────────────────────

export interface InlineHtmlResult {
  /** If this HTML fragment is pure text content (no recognized tag), emit as text node. */
  textNode: PmNode | null
  /** Mutations to apply to the caller's mark stack (open/close whitelisted marks). */
}

/**
 * Parse an inline html_inline token's content. Recognizes the exact tags the exporter emits:
 *   <u>, </u>, <mark>, </mark>, <sub>, </sub>, <sup>, </sup>,
 *   <span style="color:X">, </span>
 * Returns a textNode if the content is unrecognized HTML (degrade to text).
 * Also mutates markStack via the returned mutations array.
 */
export function parseInlineHtml(
  html: string,
  markStack: Array<{ type: string; attrs?: Record<string, unknown> }>,
): InlineHtmlResult {
  const trimmed = html.trim()

  // Opening tags
  if (/^<u>$/i.test(trimmed)) { markStack.push({ type: 'underline' }); return { textNode: null } }
  if (/^<\/u>$/i.test(trimmed)) { popMark(markStack, 'underline'); return { textNode: null } }
  if (/^<mark>$/i.test(trimmed)) { markStack.push({ type: 'highlight' }); return { textNode: null } }
  // <mark style="background-color:VALUE"> — preserve the highlight color when it round-trips.
  const markColor = /^<mark\s+style="background-color:\s*([^"]+)"\s*>$/i.exec(trimmed)
  if (markColor) {
    const color = isSafeCssColor(markColor[1])
    markStack.push(color ? { type: 'highlight', attrs: { color } } : { type: 'highlight' })
    return { textNode: null }
  }
  if (/^<\/mark>$/i.test(trimmed)) { popMark(markStack, 'highlight'); return { textNode: null } }
  if (/^<sub>$/i.test(trimmed)) { markStack.push({ type: 'subscript' }); return { textNode: null } }
  if (/^<\/sub>$/i.test(trimmed)) { popMark(markStack, 'subscript'); return { textNode: null } }
  if (/^<sup>$/i.test(trimmed)) { markStack.push({ type: 'superscript' }); return { textNode: null } }
  if (/^<\/sup>$/i.test(trimmed)) { popMark(markStack, 'superscript'); return { textNode: null } }

  // <span style="..."> — the exporter emits color and/or font-size declarations inside a
  // single style attribute (e.g. `color:red;font-size:24px`). Parse each declaration and
  // build one textStyle mark carrying whichever safe attrs are present, so color-only,
  // font-size-only, and combined spans all round-trip (previously only pure color matched,
  // so font-size was silently dropped — and a combined span lost its color too).
  const spanOpen = /^<span\s+style="([^"]*)"\s*>$/i.exec(trimmed)
  if (spanOpen) {
    const attrs: Record<string, unknown> = {}
    for (const decl of spanOpen[1].split(';')) {
      const idx = decl.indexOf(':')
      if (idx < 0) continue
      const prop = decl.slice(0, idx).trim().toLowerCase()
      const value = decl.slice(idx + 1).trim()
      if (prop === 'color') {
        const color = isSafeCssColor(value)
        if (color) attrs.color = color
      } else if (prop === 'font-size') {
        const fontSize = isSafeFontSize(value)
        if (fontSize) attrs.fontSize = fontSize
      }
    }
    // Always push a mark for the open tag so the matching </span> pops the right one, even
    // when every declaration was unsafe/unknown (mark carries no attrs in that case).
    markStack.push(Object.keys(attrs).length > 0 ? { type: 'textStyle', attrs } : { type: 'textStyle' })
    return { textNode: null }
  }
  if (/^<\/span>$/i.test(trimmed)) { popMark(markStack, 'textStyle'); return { textNode: null } }

  // Unrecognized inline HTML → degrade to plain text (never innerHTML)
  return { textNode: { type: 'text', text: html } }
}

function popMark(stack: Array<{ type: string }>, type: string): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].type === type) { stack.splice(i, 1); return }
  }
}

// ── Block HTML parsing ─────────────────────────────────────────────────────────

type InlineMapper = (text: string, warnings: string[]) => PmNode[]

/**
 * Re-parse a fragment of Markdown source into block-level PM nodes. Injected by markdown.ts so
 * callout/details bodies can contain real block content (headings, lists, code, nested
 * blockquotes) instead of collapsing to a single plain-text paragraph.
 */
export type BlockMapper = (markdown: string, warnings: string[]) => PmNode[]

/**
 * Parse a block-level html_block token. Recognizes:
 *   - <div data-callout data-variant="X">…</div> → callout node
 *   - <details><summary>…</summary>…</details> → details node
 *   - <table> with colspan/rowspan → table node
 * Unrecognized blocks degrade to paragraphs of plain text.
 *
 * When `blockMap` is supplied, callout/details BODIES are re-parsed as block content so nested
 * headings/lists/etc. survive; the summary stays inline. Without it, bodies fall back to a single
 * plain-text paragraph (legacy behavior).
 */
export function parseHtmlBlock(
  html: string,
  inlineMap: InlineMapper,
  warnings: string[],
  blockMap?: BlockMapper,
): PmNode[] {
  const trimmed = html.trim()

  // HTML comments (e.g. the exporter's signed-link notice `<!-- … -->`) carry no document
  // content — drop them entirely instead of degrading to a literal text paragraph.
  if (/^<!--[\s\S]*-->$/.test(trimmed)) return []

  // Callout: <div data-callout data-variant="info">…</div>
  const calloutMatch = /^<div\s+data-callout\s+data-variant="([^"]*)">\s*([\s\S]*)\s*<\/div>$/i.exec(trimmed)
  if (calloutMatch) {
    const variant = calloutMatch[1] || 'info'
    const innerText = calloutMatch[2].trim()
    const innerBlocks = blockMap
      ? blockMap(innerText, warnings)
      : wrapInlineAsParagraph(inlineMap(innerText, warnings))
    return [{
      type: 'callout',
      attrs: { variant },
      content: innerBlocks.length ? innerBlocks : [{ type: 'paragraph' }],
    }]
  }

  // Details: <details>\n<summary>SUMMARY</summary>\n\nINNER\n\n</details>
  const detailsMatch = /^<details>\s*<summary>([\s\S]*?)<\/summary>\s*([\s\S]*)\s*<\/details>$/i.exec(trimmed)
  if (detailsMatch) {
    const summaryText = detailsMatch[1].trim()
    const innerText = detailsMatch[2].trim()
    const summaryNodes = inlineMap(summaryText, warnings)
    const innerBlocks = blockMap
      ? blockMap(innerText, warnings)
      : wrapInlineAsParagraph(inlineMap(innerText, warnings))
    return [{
      type: 'details',
      content: [
        { type: 'detailsSummary', content: summaryNodes.length ? summaryNodes : [] },
        { type: 'detailsContent', content: innerBlocks.length ? innerBlocks : [{ type: 'paragraph' }] },
      ],
    }]
  }

  // Table with colspan/rowspan (HTML table)
  if (/^<table[\s>]/i.test(trimmed)) {
    const table = parseHtmlTable(trimmed, inlineMap, warnings)
    if (table) return [table]
  }

  // Aligned block: the exporter wraps a non-default `textAlign` paragraph as
  // `<p align="…">INNER</p>` and an aligned heading as `<div align="…">INNER</div>`
  // (INNER is markdown). Parse it symmetrically: re-parse INNER as block content
  // and stamp `textAlign` back onto the resulting paragraph/heading nodes so the
  // round-trip preserves alignment instead of leaking the raw tag as text.
  const alignMatch = /^<(p|div)\s+align="([^"]*)">\s*([\s\S]*?)\s*<\/\1>$/i.exec(trimmed)
  if (alignMatch) {
    const align = sanitizeAlign(alignMatch[2])
    const innerText = alignMatch[3].trim()
    const innerBlocks = blockMap
      ? blockMap(innerText, warnings)
      : wrapInlineAsParagraph(inlineMap(innerText, warnings))
    const blocks = innerBlocks.length ? innerBlocks : [{ type: 'paragraph' } as PmNode]
    if (align) {
      for (const b of blocks) {
        if (b.type === 'paragraph' || b.type === 'heading') {
          b.attrs = { ...(b.attrs ?? {}), textAlign: align }
        }
      }
    }
    return blocks
  }

  // Unrecognized → degrade to plain text paragraph(s)
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.map(line => ({
    type: 'paragraph',
    content: [{ type: 'text', text: line }],
  }))
}

// ── HTML table parser ─────────────────────────────────────────────────────────

/** Wrap a run of inline nodes in a single paragraph (legacy fallback when no blockMap given). */
function wrapInlineAsParagraph(inline: PmNode[]): PmNode[] {
  return inline.length ? [{ type: 'paragraph', content: inline }] : []
}

/**
 * Parse an exporter HTML-fallback `<table>` into a PM table node. Uses the DOM (DOMParser is
 * available in the browser and in the jsdom test env) rather than regex, so it correctly handles
 * NESTED tables and block cell content (images, lists, paragraphs) that the exporter emits when a
 * cell can't fit a single GFM pipe cell. A cell's children are mapped recursively to PM blocks;
 * a cell that is only inline content collapses to a single paragraph (matching a plain cell).
 */
function parseHtmlTable(
  html: string,
  inlineMap: InlineMapper,
  warnings: string[],
): PmNode | null {
  if (typeof DOMParser === 'undefined') return parseHtmlTableRegex(html, inlineMap, warnings)
  let root: Element | null
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    root = doc.querySelector('table')
  } catch {
    return parseHtmlTableRegex(html, inlineMap, warnings)
  }
  if (!root) return null
  const table = domTableToNode(root, inlineMap, warnings)
  return table && (table.content?.length ?? 0) > 0 ? table : null
}

/** Convert a DOM <table> element to a PM table node (recurses for nested tables). */
function domTableToNode(tableEl: Element, inlineMap: InlineMapper, warnings: string[]): PmNode {
  const rows: PmNode[] = []
  // Only DIRECT rows of THIS table (skip rows that belong to a nested table in a cell).
  const trEls: Element[] = []
  for (const section of Array.from(tableEl.children)) {
    const tag = section.tagName.toLowerCase()
    if (tag === 'tr') trEls.push(section)
    else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      for (const tr of Array.from(section.children)) if (tr.tagName.toLowerCase() === 'tr') trEls.push(tr)
    }
  }
  for (const tr of trEls) {
    const cells: PmNode[] = []
    for (const cellEl of Array.from(tr.children)) {
      const tag = cellEl.tagName.toLowerCase()
      if (tag !== 'td' && tag !== 'th') continue
      const colspan = Math.max(1, parseInt(cellEl.getAttribute('colspan') ?? '1', 10) || 1)
      const rowspan = Math.max(1, parseInt(cellEl.getAttribute('rowspan') ?? '1', 10) || 1)
      const blocks = domCellToBlocks(cellEl, inlineMap, warnings)
      const cell: PmNode = {
        type: tag === 'th' ? 'tableHeader' : 'tableCell',
        content: blocks.length ? blocks : [{ type: 'paragraph' }],
      }
      if (colspan > 1 || rowspan > 1) {
        cell.attrs = {}
        if (colspan > 1) cell.attrs.colspan = colspan
        if (rowspan > 1) cell.attrs.rowspan = rowspan
      }
      cells.push(cell)
    }
    if (cells.length) rows.push({ type: 'tableRow', content: cells })
  }
  return { type: 'table', content: rows }
}

/** Map a <td>/<th>'s children to PM block nodes. Bare inline content becomes one paragraph. */
function domCellToBlocks(cellEl: Element, inlineMap: InlineMapper, warnings: string[]): PmNode[] {
  const out: PmNode[] = []
  let inlineRun = ''
  const flushInline = () => {
    const text = inlineRun.trim()
    inlineRun = ''
    if (!text) return
    const inline = inlineMap(text, warnings)
    if (inline.length) out.push({ type: 'paragraph', content: inline })
  }
  for (const child of Array.from(cellEl.childNodes)) {
    if (child.nodeType === 3 /* text */) {
      inlineRun += (child.textContent ?? '')
      continue
    }
    if (child.nodeType !== 1) continue
    const el = child as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'table') {
      flushInline()
      out.push(domTableToNode(el, inlineMap, warnings))
    } else if (tag === 'img') {
      flushInline()
      const img = domImgToNode(el)
      if (img) out.push(img)
    } else if (tag === 'p') {
      flushInline()
      const inline = inlineMap((el.innerHTML || '').trim(), warnings)
      out.push(inline.length ? { type: 'paragraph', content: inline } : { type: 'paragraph' })
    } else if (tag === 'ul' || tag === 'ol') {
      flushInline()
      out.push(domListToNode(el, tag === 'ol', inlineMap, warnings))
    } else if (/^h[1-6]$/.test(tag)) {
      flushInline()
      out.push({ type: 'heading', attrs: { level: Number(tag[1]) }, content: inlineMap((el.innerHTML || '').trim(), warnings) })
    } else if (tag === 'pre') {
      flushInline()
      const code = el.textContent ?? ''
      const codeBlock: PmNode = { type: 'codeBlock', attrs: {} }
      if (code) codeBlock.content = [{ type: 'text', text: code }]
      out.push(codeBlock)
    } else if (tag === 'blockquote') {
      flushInline()
      const inner = domCellToBlocks(el, inlineMap, warnings)
      out.push({ type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] })
    } else if (tag === 'hr') {
      flushInline()
      out.push({ type: 'horizontalRule' })
    } else {
      // Unknown inline-ish element: fold its HTML into the inline run.
      inlineRun += el.outerHTML
    }
  }
  flushInline()
  return out
}

function domImgToNode(el: Element): PmNode | null {
  const src = el.getAttribute('src') ?? ''
  if (!/^https?:\/\//i.test(src.trim())) return null
  const safe = isSafeHref(src)
  if (!safe) return null
  const attrs: Record<string, unknown> = { src: safe }
  const m = /\/(att_[A-Za-z0-9]+)(?:\/|\?|$)/.exec(src)
  if (m) attrs.attachId = m[1]
  const alt = el.getAttribute('alt')
  if (alt) attrs.alt = alt
  return { type: 'image', attrs }
}

function domListToNode(el: Element, ordered: boolean, inlineMap: InlineMapper, warnings: string[]): PmNode {
  const items: PmNode[] = []
  for (const liEl of Array.from(el.children)) {
    if (liEl.tagName.toLowerCase() !== 'li') continue
    const blocks = domCellToBlocks(liEl, inlineMap, warnings)
    items.push({ type: 'listItem', content: blocks.length ? blocks : [{ type: 'paragraph' }] })
  }
  return { type: ordered ? 'orderedList' : 'bulletList', content: items }
}

/** Legacy regex fallback for environments without DOMParser (kept for flat exporter tables). */
function parseHtmlTableRegex(
  html: string,
  inlineMap: InlineMapper,
  _warnings: string[],
): PmNode | null {
  const rows: PmNode[] = []
  const trRe = /<tr>([\s\S]*?)<\/tr>/gi
  let trMatch: RegExpExecArray | null
  while ((trMatch = trRe.exec(html))) {
    const cells: PmNode[] = []
    const cellRe = /<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(trMatch[1]))) {
      const tag = cellMatch[1].toLowerCase()
      const attrStr = cellMatch[2]
      const content = cellMatch[3].trim()

      const colspan = parseAttr(attrStr, 'colspan')
      const rowspan = parseAttr(attrStr, 'rowspan')

      const cellInline = content ? inlineMap(content, []) : []
      const cell: PmNode = {
        type: tag === 'th' ? 'tableHeader' : 'tableCell',
        content: cellInline.length ? [{ type: 'paragraph', content: cellInline }] : [{ type: 'paragraph' }],
      }
      if (colspan > 1 || rowspan > 1) {
        cell.attrs = {}
        if (colspan > 1) cell.attrs.colspan = colspan
        if (rowspan > 1) cell.attrs.rowspan = rowspan
      }
      cells.push(cell)
    }
    if (cells.length) rows.push({ type: 'tableRow', content: cells })
  }
  if (!rows.length) return null
  return { type: 'table', content: rows }
}

function parseAttr(attrStr: string, name: string): number {
  const m = new RegExp(`${name}="(\\d+)"`, 'i').exec(attrStr)
  return m ? Math.max(1, parseInt(m[1], 10)) : 1
}
