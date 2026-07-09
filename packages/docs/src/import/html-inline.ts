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

  // <span style="color:VALUE">
  const spanMatch = /^<span\s+style="color:\s*([^"]+)"\s*>$/i.exec(trimmed)
  if (spanMatch) {
    const color = isSafeCssColor(spanMatch[1])
    if (color) markStack.push({ type: 'textStyle', attrs: { color } })
    // If color is unsafe, we still push nothing — the </span> close will be a no-op
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
        { type: 'detailsSummary', content: summaryNodes.length ? summaryNodes : [{ type: 'text', text: '' }] },
        { type: 'detailsContent', content: innerBlocks.length ? innerBlocks : [{ type: 'paragraph' }] },
      ],
    }]
  }

  // Table with colspan/rowspan (HTML table)
  if (/^<table[\s>]/i.test(trimmed)) {
    const table = parseHtmlTable(trimmed, inlineMap, warnings)
    if (table) return [table]
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

function parseHtmlTable(
  html: string,
  inlineMap: InlineMapper,
  _warnings: string[],
): PmNode | null {
  const rows: PmNode[] = []
  // Simple regex-based row/cell extraction. Sufficient for the exporter's clean output;
  // not a general HTML parser (which would be overkill for this controlled input).
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
        content: [{ type: 'paragraph', content: cellInline.length ? cellInline : [{ type: 'text', text: '' }] }],
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
