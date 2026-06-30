// Lossless Markdown export (batch 8, area C).
//
// Walks the editor's ProseMirror JSON (editor.getJSON()) and serializes it to Markdown/GFM,
// falling back to inline HTML for anything Markdown can't express — no node is silently
// dropped. Images and file attachments are emitted with FRESHLY-resolved signed URLs
// (RES-4: images carry their durable `attachId`, not just a stale `src`), batched through
// the resolve endpoint (RES-1 cap: <=200 ids per call). Never base64, never a zip.

import { resolveAttachments, type ResolvedAttachment } from '../attachments/api.ts'
import { t } from '../octoweb/index.ts'

/** ProseMirror-JSON node (the bits the serializer reads). */
export interface MdNode {
  type: string
  attrs?: Record<string, unknown>
  content?: MdNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

export interface ExportOptions {
  /** Batch size for the resolve endpoint (RES-1 cap). Default 200. */
  batchSize?: number
  /** Resolve fn injection point (tests pass a stub). Defaults to the real REST client. */
  resolve?: typeof resolveAttachments
  /** name → unicode glyph for emoji nodes; defaults to the editor's emoji map. */
  emojiGlyph?: (name: string | null | undefined) => string | undefined
}

/** Header note (localized via the `docs` i18n namespace) warning that asset links are signed and may expire. */
function exportHeader(): string {
  return `<!-- ${t('docs.toolbar.exportSignedLinkNotice')} -->`
}

interface Ctx {
  urls: Map<string, ResolvedAttachment>
  emojiGlyph?: (name: string | null | undefined) => string | undefined
}

/** Collect durable attachIds from BOTH image and fileAttachment nodes (RES-4). */
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

function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * Serialize a PM-JSON document to a Markdown string. Resolves fresh signed URLs for all
 * referenced attachments first (chunked to <=batchSize), then walks the tree.
 */
export async function exportDocToMarkdown(
  docId: string,
  doc: MdNode,
  opts: ExportOptions = {},
): Promise<string> {
  const batchSize = opts.batchSize ?? 200
  const resolve = opts.resolve ?? resolveAttachments
  const ids = collectAttachIds(doc)

  const urls = new Map<string, ResolvedAttachment>()
  for (const idChunk of chunk(ids, batchSize)) {
    if (idChunk.length === 0) continue
    const res = await resolve(docId, idChunk)
    for (const item of res.items) urls.set(item.attachId, item)
  }

  const ctx: Ctx = { urls, emojiGlyph: opts.emojiGlyph }
  const body = serializeBlocks(doc.content ?? [], ctx)
  const header = exportHeader()
  return body ? `${header}\n\n${body}\n` : `${header}\n`
}

/** Join block-level nodes with a blank line between them. */
function serializeBlocks(nodes: MdNode[], ctx: Ctx): string {
  return nodes
    .map((n) => serializeBlock(n, ctx))
    .filter((s) => s != null && s !== '')
    .join('\n\n')
}

function serializeBlock(node: MdNode, ctx: Ctx): string {
  switch (node.type) {
    case 'paragraph':
      return wrapAlign(escapeLeadingBlockMarkers(serializeInline(node.content ?? [], ctx)), node)
    case 'heading': {
      const level = clampLevel(node.attrs?.level)
      return wrapAlign(`${'#'.repeat(level)} ${serializeInline(node.content ?? [], ctx)}`, node)
    }
    case 'bulletList':
      return serializeList(node, false, ctx, 0)
    case 'orderedList':
      return serializeList(node, true, ctx, 0)
    case 'taskList':
      return serializeList(node, false, ctx, 0)
    case 'blockquote':
      return prefixLines(serializeBlocks(node.content ?? [], ctx), '> ')
    case 'codeBlock': {
      const lang = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
      const code = (node.content ?? []).map((c) => c.text ?? '').join('')
      return '```' + lang + '\n' + code + '\n```'
    }
    case 'horizontalRule':
      return '---'
    case 'table':
      return serializeTable(node, ctx)
    case 'image':
      return serializeImage(node, ctx)
    case 'fileAttachment':
      return serializeFileAttachment(node, ctx)
    case 'bookmark':
      return serializeBookmark(node)
    case 'callout':
      return serializeCallout(node, ctx)
    case 'blockMath':
      return `$$\n${node.attrs?.latex ?? ''}\n$$`
    case 'details':
      return serializeDetails(node, ctx)
    default:
      // Never drop content: recurse into an unknown container, or emit any raw text.
      if (node.content && node.content.length) return serializeBlocks(node.content, ctx)
      if (node.text) return node.text
      return ''
  }
}

function clampLevel(level: unknown): number {
  const n = typeof level === 'number' ? level : 1
  return Math.min(6, Math.max(1, n))
}

/** Wrap a block in an aligned HTML tag when textAlign is set to a non-default value. */
function wrapAlign(inner: string, node: MdNode): string {
  const align = node.attrs?.textAlign
  if (typeof align === 'string' && align && align !== 'left') {
    const tag = node.type === 'heading' ? 'div' : 'p'
    return `<${tag} align="${align}">${inner}</${tag}>`
  }
  return inner
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((l) => prefix + l)
    .join('\n')
}

/**
 * Escape a literal Markdown block marker at the start of each line so plain text that
 * happens to begin with `- `, `* `, `+ `, `> `, `#`, or `1.` is not re-parsed as a list /
 * quote / heading on import. Keeps export lossless: the rendered text stays exactly what
 * the user typed (e.g. a paragraph reading "- Bullet item two" exports as "\\- Bullet item
 * two", not a spurious list item). Only the leading marker is escaped; inline content is
 * untouched.
 */
function escapeLeadingBlockMarkers(text: string): string {
  if (!text) return text
  return text
    .split('\n')
    .map((line) =>
      line.replace(/^(\s*)([-*+>#]|\d+[.)])(\s)/, (_m, indent: string, marker: string, sp: string) => {
        // For an ordered-list marker (digits + . or )) escape the punctuation, not the digit
        // (`1.` -> `1\.`, the CommonMark-standard form); for the single-char markers
        // (- * + > #) escape the marker itself (`-` -> `\-`).
        const escaped = /^\d/.test(marker)
          ? marker.replace(/([.)])$/, '\\$1')
          : '\\' + marker
        return indent + escaped + sp
      }),
    )
    .join('\n')
}

// ── Lists ────────────────────────────────────────────────────────────────────

function serializeList(node: MdNode, ordered: boolean, ctx: Ctx, depth: number): string {
  const items = node.content ?? []
  return items
    .map((item, idx) => serializeListItem(item, ordered, idx, ctx, depth))
    // Drop empty items so an item with no content never emits a bare dangling marker (`- `).
    .filter((s) => s !== '')
    .join('\n')
}

function serializeListItem(
  item: MdNode,
  ordered: boolean,
  idx: number,
  ctx: Ctx,
  depth: number,
): string {
  const indent = '  '.repeat(depth)
  let marker: string
  if (item.type === 'taskItem') marker = item.attrs?.checked ? '- [x] ' : '- [ ] '
  else marker = ordered ? `${idx + 1}. ` : '- '

  const blocks = item.content ?? []
  let line = indent + marker
  let body = ''
  const trailing: string[] = []
  blocks.forEach((b, i) => {
    if (b.type === 'bulletList' || b.type === 'orderedList' || b.type === 'taskList') {
      trailing.push(serializeList(b, b.type === 'orderedList', ctx, depth + 1))
    } else if (i === 0) {
      body = serializeBlock(b, ctx)
      line += body
    } else {
      // Continuation block under the same item — indent to align with the marker text.
      trailing.push(prefixLines(serializeBlock(b, ctx), indent + '  '))
    }
  })
  // An item with no first-block text AND no nested/trailing content is empty — emit nothing
  // (rather than a dangling bare marker). A task item is always kept (the checkbox is content).
  if (item.type !== 'taskItem' && body.trim() === '' && trailing.length === 0) return ''
  return [line, ...trailing].join('\n')
}

// ── Tables ───────────────────────────────────────────────────────────────────

function cellText(cell: MdNode, ctx: Ctx): string {
  // A cell holds block content (usually paragraphs); flatten to single-line inline.
  return serializeBlocks(cell.content ?? [], ctx).replace(/\n+/g, ' ').trim()
}

function hasMergedCells(node: MdNode): boolean {
  return (node.content ?? []).some((row) =>
    (row.content ?? []).some((cell) => {
      const colspan = Number(cell.attrs?.colspan ?? 1)
      const rowspan = Number(cell.attrs?.rowspan ?? 1)
      return colspan > 1 || rowspan > 1
    }),
  )
}

function serializeTable(node: MdNode, ctx: Ctx): string {
  // Merged cells can't be expressed in GFM pipe tables → inline HTML fallback.
  if (hasMergedCells(node)) return serializeTableHtml(node, ctx)

  const rows = node.content ?? []
  if (rows.length === 0) return ''
  const grid = rows.map((row) =>
    (row.content ?? []).map((cell) => cellText(cell, ctx).replace(/\|/g, '\\|')),
  )
  const cols = grid[0].length
  const lines: string[] = []
  lines.push(`| ${grid[0].join(' | ')} |`)
  lines.push(`| ${Array(cols).fill('---').join(' | ')} |`)
  for (let i = 1; i < grid.length; i++) lines.push(`| ${grid[i].join(' | ')} |`)
  return lines.join('\n')
}

function serializeTableHtml(node: MdNode, ctx: Ctx): string {
  const rows = node.content ?? []
  const out: string[] = ['<table>']
  for (const row of rows) {
    out.push('<tr>')
    for (const cell of row.content ?? []) {
      const tag = cell.type === 'tableHeader' ? 'th' : 'td'
      const colspan = Number(cell.attrs?.colspan ?? 1)
      const rowspan = Number(cell.attrs?.rowspan ?? 1)
      const attrs =
        (colspan > 1 ? ` colspan="${colspan}"` : '') + (rowspan > 1 ? ` rowspan="${rowspan}"` : '')
      out.push(`<${tag}${attrs}>${cellText(cell, ctx)}</${tag}>`)
    }
    out.push('</tr>')
  }
  out.push('</table>')
  return out.join('\n')
}

// ── Atoms ────────────────────────────────────────────────────────────────────

function serializeImage(node: MdNode, ctx: Ctx): string {
  const attachId = node.attrs?.attachId
  const resolved = typeof attachId === 'string' ? ctx.urls.get(attachId) : undefined
  const url = resolved?.url ?? (typeof node.attrs?.src === 'string' ? node.attrs.src : '') ?? ''
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''
  const title = typeof node.attrs?.title === 'string' && node.attrs.title ? ` "${node.attrs.title}"` : ''
  return `![${alt}](${url}${title})`
}

function serializeFileAttachment(node: MdNode, ctx: Ctx): string {
  const attachId = node.attrs?.attachId
  const resolved = typeof attachId === 'string' ? ctx.urls.get(attachId) : undefined
  const name =
    (typeof node.attrs?.fileName === 'string' && node.attrs.fileName) ||
    resolved?.fileName ||
    'attachment'
  if (resolved?.url) return `[${name}](${resolved.url})`
  // Not resolved (notFound / expired) — keep the name visible, don't crash or invent a link.
  return `[${name}]() <!-- attachment unavailable -->`
}

function serializeBookmark(node: MdNode): string {
  // bookmark.url is an external user URL — used as-is, never resolved.
  const url = typeof node.attrs?.url === 'string' ? node.attrs.url : ''
  const title = (typeof node.attrs?.title === 'string' && node.attrs.title) || url
  return `[${title}](${url})`
}

function serializeCallout(node: MdNode, ctx: Ctx): string {
  const variant = typeof node.attrs?.variant === 'string' ? node.attrs.variant : 'info'
  const inner = serializeBlocks(node.content ?? [], ctx)
  return `<div data-callout data-variant="${variant}">\n\n${inner}\n\n</div>`
}

function serializeDetails(node: MdNode, ctx: Ctx): string {
  const children = node.content ?? []
  const summaryNode = children.find((c) => c.type === 'detailsSummary')
  const contentNode = children.find((c) => c.type === 'detailsContent')
  const summary = summaryNode ? serializeInline(summaryNode.content ?? [], ctx) : ''
  const inner = contentNode ? serializeBlocks(contentNode.content ?? [], ctx) : serializeBlocks(children, ctx)
  return `<details>\n<summary>${summary}</summary>\n\n${inner}\n\n</details>`
}

// ── Inline ─────────────────────────────────────────────────────────────────--

function serializeInline(nodes: MdNode[], ctx: Ctx): string {
  return nodes.map((n) => serializeInlineNode(n, ctx)).join('')
}

function serializeInlineNode(node: MdNode, ctx: Ctx): string {
  switch (node.type) {
    case 'text':
      return applyMarks(node.text ?? '', node.marks ?? [])
    case 'hardBreak':
      return '  \n'
    case 'image':
      return serializeImage(node, ctx)
    case 'inlineMath':
      return `$${node.attrs?.latex ?? ''}$`
    case 'mention': {
      // C-2: plain text @displayName — never a dead [](uid) link.
      const label = node.attrs?.label ?? node.attrs?.id ?? ''
      return `@${label}`
    }
    case 'emoji': {
      const name = typeof node.attrs?.name === 'string' ? node.attrs.name : null
      const glyph = ctx.emojiGlyph?.(name)
      return glyph ?? (name ? `:${name}:` : '')
    }
    default:
      if (node.content && node.content.length) return serializeInline(node.content, ctx)
      return node.text ?? ''
  }
}

function applyMarks(text: string, marks: Array<{ type: string; attrs?: Record<string, unknown> }>): string {
  let out = text
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        out = `**${out}**`
        break
      case 'italic':
      case 'em':
        out = `*${out}*`
        break
      case 'code':
        out = '`' + out + '`'
        break
      case 'strike':
        out = `~~${out}~~`
        break
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : ''
        out = `[${out}](${href})`
        break
      }
      case 'underline':
        out = `<u>${out}</u>`
        break
      case 'highlight':
        out = `<mark>${out}</mark>`
        break
      case 'textStyle': {
        const color = mark.attrs?.color
        if (typeof color === 'string' && color) out = `<span style="color:${color}">${out}</span>`
        break
      }
      case 'subscript':
        out = `<sub>${out}</sub>`
        break
      case 'superscript':
        out = `<sup>${out}</sup>`
        break
    }
  }
  return out
}
