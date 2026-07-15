// Markdown → ProseMirror-JSON import (reverse of ../export/markdown.ts).
//
// Parses a Markdown/GFM string with markdown-it, then maps the token stream onto the
// editor's ProseMirror schema (SCHEMA_VERSION 15). This is the strict inverse of the
// export serializer: every node/mark the exporter can emit has a mapping back here, so a
// round-trip (export → import) reconstructs the document structure.
//
// Design doc: docs/markdown-import-design.md
//
// Security (inherited from the PDF-export lessons):
//   - every link href / image src passes a scheme whitelist (http/https/mailto/tel/relative);
//     javascript:/data:/vbscript: and tab-bypass variants are dropped.
//   - inline <span style="color:…"> values pass a CSS-color whitelist; anything with
//     `;`/`(`/`)` or an unknown token is discarded (blocks `red;position:fixed` injection).
//   - unknown/unhandled HTML is NEVER innerHTML-injected — it degrades to plain text.

import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { stripFrontMatter } from './frontmatter.ts'
import { isSafeHref, parseInlineHtml, parseHtmlBlock, type BlockMapper } from './html-inline.ts'

/** ProseMirror-JSON node (mirrors export's MdNode). */
export interface PmNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PmNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

export interface ImportResult {
  /** The parsed ProseMirror document (type: 'doc'). Ready for editor.commands.setContent. */
  doc: PmNode
  /** Best-effort title: front-matter title → first H1 text → null (caller falls back to filename). */
  title: string | null
  /** Non-fatal notes surfaced to the user (e.g. "3 local images could not be imported"). */
  warnings: string[]
}

export interface ImportOptions {
  /**
   * Resolver for `:shortcode:` emoji: given the shortcode/name, return its glyph (or any truthy
   * value) when it is a real emoji, or undefined when unknown. Unknown shortcodes stay as literal
   * `:name:` text instead of becoming blank emoji nodes.
   */
  emojiName?: (name: string) => string | undefined
  /**
   * Translator for user-facing warning / placeholder text. Given an i18n key
   * (and optional interpolation params) it returns the localized string. When
   * omitted, callers fall back to the raw key so the parser stays pure and the
   * source carries no hard-coded UI strings.
   */
  t?: (key: string, params?: Record<string, string | number>) => string
}

let mdInstance: MarkdownIt | null = null
function md(): MarkdownIt {
  if (mdInstance) return mdInstance
  mdInstance = new MarkdownIt('commonmark', { html: true, linkify: false, breaks: false })
    .enable(['table', 'strikethrough'])
  // Tokenize `$…$` / `$$…$$` math BEFORE markdown-it's escape rule runs, so that
  // LaTeX backslash sequences survive verbatim. Without this the inline text
  // pass collapses `\\` (a matrix/cases/substack row break) to `\` and eats
  // other `\x` escapes, corrupting every multi-line formula. The tokens carry
  // the RAW source; mapInline maps math_inline/math_block below.
  mdInstance.inline.ruler.before('escape', 'math_dollar', mathInlineRule)
  return mdInstance
}

/**
 * markdown-it inline rule for dollar-delimited math. Recognises `$$…$$` (inline
 * display) and `$…$`, applying CommonMark/pandoc-ish boundary rules so ordinary
 * currency (`$5`, `$5 到 $9`) is not swallowed: the opening `$` must not be
 * followed by whitespace, and the closing `$` must not be preceded by whitespace
 * nor (for single `$`) directly followed by a digit. Content is taken verbatim
 * from the source so LaTeX escapes (`\\`, `\{`, …) are preserved.
 */
function mathInlineRule(state: unknown, silent: boolean): boolean {
  const s = state as {
    src: string
    pos: number
    posMax: number
    push: (type: string, tag: string, nesting: number) => { content: string; markup: string }
  }
  const src = s.src
  let pos = s.pos
  if (src.charCodeAt(pos) !== 0x24 /* $ */) return false

  const isDisplay = src.charCodeAt(pos + 1) === 0x24
  const open = isDisplay ? 2 : 1
  const start = pos + open
  if (start >= s.posMax) return false
  // Opening boundary: no whitespace right after the opener.
  if (/\s/.test(src[start] ?? '')) return false

  // Find the matching closer within the current inline span.
  const closer = isDisplay ? '$$' : '$'
  let end = -1
  for (let i = start; i < s.posMax; i++) {
    if (isDisplay) {
      if (src.charCodeAt(i) === 0x24 && src.charCodeAt(i + 1) === 0x24) {
        end = i
        break
      }
    } else if (src.charCodeAt(i) === 0x24) {
      end = i
      break
    }
  }
  if (end < 0 || end === start) return false

  const content = src.slice(start, end)
  // Closing boundary for single `$`: no trailing whitespace before it, and not a
  // bare currency range (closer not directly followed by a digit).
  if (!isDisplay) {
    if (/\s$/.test(content)) return false
    if (/[0-9]/.test(src[end + 1] ?? '')) return false
  }
  if (!content.trim()) return false

  if (!silent) {
    const token = s.push(isDisplay ? 'math_block' : 'math_inline', 'math', 0)
    token.content = content
    token.markup = closer
  }
  s.pos = end + open
  return true
}

/**
 * Parse a Markdown string into a ProseMirror document. Pure (no network, no editor);
 * the caller creates the doc and injects `result.doc` after the editor loads.
 */
export function parseMarkdownToPmDoc(input: string, opts: ImportOptions = {}): ImportResult {
  const warnings: string[] = []
  const { body, frontMatter } = stripFrontMatter(input)

  const tokens = md().parse(body, {})
  const ctx: Ctx = { opts, warnings, localImageCount: 0, sourceLines: body.split('\n') }
  const content = mapBlockTokens(tokens, ctx)

  // Empty doc guard: ProseMirror requires at least one block child.
  if (content.length === 0) content.push({ type: 'paragraph' })

  const fmTitle = frontMatter.title?.trim() || null
  const title = fmTitle ?? firstHeadingText(content)

  if (ctx.localImageCount > 0) {
    warnings.push(
      tr(opts, 'docs.import.localImagesSkipped', { count: ctx.localImageCount }),
    )
  }

  return { doc: { type: 'doc', content }, title, warnings }
}

/**
 * Translate an i18n key via the optional translator, falling back to the key
 * itself when none is supplied. Keeps the parser free of hard-coded UI strings
 * (the i18n gate scans source for CJK literals).
 */
function tr(
  opts: ImportOptions,
  key: string,
  params?: Record<string, string | number>,
): string {
  return opts.t ? opts.t(key, params) : key
}

interface Ctx {
  opts: ImportOptions
  warnings: string[]
  localImageCount: number
  /** Raw body source split by line, so html_block reassembly can slice original Markdown. */
  sourceLines: string[]
}

function firstHeadingText(nodes: PmNode[]): string | null {
  for (const n of nodes) {
    if (n.type === 'heading' && (n.attrs?.level ?? 1) === 1) {
      const txt = collectText(n).trim()
      if (txt) return txt
    }
  }
  return null
}

function collectText(node: PmNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(collectText).join('')
}

// ── Block token walk ───────────────────────────────────────────────────────

/**
 * markdown-it emits a flat token stream with *_open / *_close pairs. We consume it with a
 * cursor and recurse into container ranges.
 */
function mapBlockTokens(tokens: Token[], ctx: Ctx): PmNode[] {
  const out: PmNode[] = []
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]
    switch (tok.type) {
      case 'heading_open': {
        const level = clampLevel(Number(tok.tag.slice(1)))
        const { inline, next } = takeInline(tokens, i, ctx)
        out.push({ type: 'heading', attrs: { level }, content: inline })
        i = next
        break
      }
      case 'paragraph_open': {
        // A whole-paragraph `$$…$$` is block math. CommonMark has no math node and this repo
        // doesn't load a texmath plugin, so the exporter's `$$\n…\n$$` arrives as a plain
        // paragraph; detect it from the raw inline source (which preserves newlines) and emit
        // a blockMath node — the strict inverse of export's serializeBlock('blockMath').
        const rawInline = tokens[i + 1]
        const rawText =
          rawInline && rawInline.type === 'inline' ? rawInline.content : ''
        const blockMath = detectBlockMath(rawText)
        if (blockMath) {
          out.push(blockMath)
          i = i + 3 // paragraph_open + inline + paragraph_close
          break
        }
        const { inline, next } = takeInline(tokens, i, ctx)
        // A paragraph's inline run may contain BLOCK image nodes (our image node is
        // group 'block', not inline). A block node inside a paragraph's inline content is
        // schema-invalid — ProseMirror drops/normalizes it, so the image silently vanishes
        // even though its bytes load. Split the run into valid blocks: standalone images
        // become their own block, contiguous true-inline nodes stay in a paragraph.
        for (const b of blocksFromInline(inline)) out.push(b)
        i = next
        break
      }
      case 'bullet_list_open': {
        const { node, next } = takeList(tokens, i, 'bulletList', ctx)
        out.push(node)
        i = next
        break
      }
      case 'ordered_list_open': {
        const { node, next } = takeList(tokens, i, 'orderedList', ctx)
        out.push(node)
        i = next
        break
      }
      case 'blockquote_open': {
        const end = matchClose(tokens, i, 'blockquote_open', 'blockquote_close')
        const inner = mapBlockTokens(tokens.slice(i + 1, end), ctx)
        out.push({ type: 'blockquote', content: inner.length ? inner : [{ type: 'paragraph' }] })
        i = end + 1
        break
      }
      case 'fence':
      case 'code_block': {
        const lang = tok.type === 'fence' ? (tok.info || '').trim().split(/\s+/)[0] : ''
        const code = tok.content.replace(/\n$/, '')
        const node: PmNode = { type: 'codeBlock', attrs: lang ? { language: lang } : {} }
        if (code) node.content = [{ type: 'text', text: code }]
        out.push(node)
        i += 1
        break
      }
      case 'hr':
        out.push({ type: 'horizontalRule' })
        i += 1
        break
      case 'table_open': {
        const end = matchClose(tokens, i, 'table_open', 'table_close')
        out.push(mapTable(tokens.slice(i + 1, end), ctx))
        i = end + 1
        break
      }
      case 'math_block': // markdown-it-texmath style; also handled via fence info below
        out.push({ type: 'blockMath', attrs: { latex: tok.content.trim() } })
        i += 1
        break
      case 'html_block': {
        // markdown-it splits multi-line HTML blocks at blank lines, so a callout/details
        // becomes: html_block(open) → paragraph(s) → html_block(close). Reassemble them.
        // The re-parse of a callout/details BODY runs on a NEW substring, so it needs a ctx
        // whose sourceLines match THAT substring (nested details reassembly slices sourceLines
        // by the substring's own `.map` ranges; sharing the outer sourceLines would slice the
        // wrong lines and leak the inner `<details>`/`<summary>` tags as literal text).
        const blockMap: BlockMapper = (markdown) =>
          mapBlockTokens(md().parse(markdown, {}), { ...ctx, sourceLines: markdown.split('\n') })
        const assembled = tryAssembleHtmlBlock(tokens, i, ctx)
        if (assembled) {
          const nodes = parseHtmlBlock(assembled.html, (t) => mapInlineHtmlText(t, ctx), ctx.warnings, blockMap)
          for (const n of nodes) out.push(n)
          i = assembled.next
        } else {
          const nodes = parseHtmlBlock(tok.content, (t) => mapInlineHtmlText(t, ctx), ctx.warnings, blockMap)
          for (const n of nodes) out.push(n)
          i += 1
        }
        break
      }
      default:
        i += 1
    }
  }
  return out
}

/**
 * Try to reassemble a split HTML block. markdown-it breaks multi-line HTML at blank lines,
 * so `<div data-callout>\n\ncontent\n\n</div>` becomes several tokens:
 *   html_block("<div ...>") → heading/paragraph/list… → html_block("</div>")
 * We reassemble the RAW body Markdown by slicing the original source lines between the open
 * and close html_block tokens (using their `.map` line ranges) rather than re-serializing the
 * already-parsed inner tokens — the latter drops block markup (`#`, `-`, `1.`) and would
 * flatten a callout heading/list into plain text. The caller re-parses the raw body as blocks.
 */
function tryAssembleHtmlBlock(
  tokens: Token[],
  openIdx: number,
  ctx: Ctx,
): { html: string; next: number } | null {
  const openTok = tokens[openIdx]
  const openContent = openTok.content.trim()

  // Detect opening tags that we know get split
  const isCalloutOpen = /^<div\s+data-callout/i.test(openContent)
  const isDetailsOpen = /^<details>/i.test(openContent)

  if (!isCalloutOpen && !isDetailsOpen) return null

  const closeTag = isCalloutOpen ? '</div>' : '</details>'
  // Regexes to recognise a nested opener of the SAME kind, so we can depth-balance and stop at
  // the opener's OWN closing tag rather than the first inner one. markdown-it emits each nested
  // `<details>`/`<div data-callout>` opener as its own html_block token (they start on their own
  // line), so counting opener vs closer html_block tokens gives correct nesting depth.
  const openRe = isCalloutOpen ? /^<div\s+data-callout/i : /^<details>/i

  // Scan forward for the matching closing html_block, balancing nested openers of the same kind.
  let depth = 1
  for (let j = openIdx + 1; j < tokens.length; j++) {
    const t = tokens[j]
    if (t.type !== 'html_block') continue
    const content = t.content.trim()
    if (openRe.test(content)) {
      depth++
      continue
    }
    if (content === closeTag) {
      depth--
      if (depth > 0) continue
      // Slice the raw body Markdown from the source (open block end → close block start).
      const openEnd = openTok.map ? openTok.map[1] : null
      const closeStart = t.map ? t.map[0] : null
      let inner: string
      if (openEnd != null && closeStart != null && closeStart >= openEnd) {
        inner = ctx.sourceLines.slice(openEnd, closeStart).join('\n').trim()
      } else {
        // No line map (shouldn't happen for block tokens) — fall back to the parsed inline text.
        inner = collectRawInline(tokens, openIdx + 1, j)
      }
      const html = `${openContent}\n\n${inner}\n\n${closeTag}`
      return { html, next: j + 1 }
    }
  }
  return null
}

/** Fallback body reconstruction from parsed inline tokens (loses block markup; last resort). */
function collectRawInline(tokens: Token[], from: number, to: number): string {
  const parts: string[] = []
  for (let j = from; j < to; j++) {
    const t = tokens[j]
    if (t.type === 'inline') parts.push(t.content)
    else if (t.type === 'html_block') parts.push(t.content.trim())
  }
  return parts.join('\n').trim()
}

/**
 * Detect a whole-paragraph `$$…$$` block (the exporter emits block math as `$$\n<latex>\n$$`).
 * Operates on the raw inline source so multi-line LaTeX keeps its newlines. Returns a
 * blockMath node, or null when the paragraph is not a standalone math block.
 */
function detectBlockMath(rawText: string): PmNode | null {
  const t = rawText.trim()
  const m = /^\$\$([\s\S]+?)\$\$$/.exec(t)
  if (!m) return null
  const latex = m[1].trim()
  if (!latex) return null
  return { type: 'blockMath', attrs: { latex } }
}

function clampLevel(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(6, Math.max(1, Math.trunc(n)))
}

function matchClose(tokens: Token[], openIdx: number, openType: string, closeType: string): number {
  let depth = 0
  for (let j = openIdx; j < tokens.length; j++) {
    if (tokens[j].type === openType) depth++
    else if (tokens[j].type === closeType) {
      depth--
      if (depth === 0) return j
    }
  }
  return tokens.length - 1
}

/** Consume a heading_open/paragraph_open → inline → *_close triple, return inline PM nodes. */
function takeInline(tokens: Token[], openIdx: number, ctx: Ctx): { inline: PmNode[]; next: number } {
  const inlineTok = tokens[openIdx + 1]
  const closeIdx = openIdx + 2
  const inline = inlineTok && inlineTok.type === 'inline' ? mapInline(inlineTok, ctx) : []
  return { inline, next: closeIdx + 1 }
}

/**
 * Split a flat inline-node run (from mapInline) into schema-valid BLOCK nodes.
 *
 * Our `image` node is group 'block' (not inline), so it must never sit inside a paragraph's
 * inline content — ProseMirror treats a block child in an inline position as invalid and
 * drops/normalizes it away, which is exactly why imported images (top-level and inside table
 * cells) load their bytes but never render. This lifts every block image out to its own block
 * node and keeps contiguous true-inline nodes (text, hardBreak, inlineMath, emoji…) grouped
 * into paragraphs, preserving order. Trailing/leading whitespace-only paragraphs are dropped
 * when an image is present so a lone `![](url)` cell doesn't gain an empty paragraph.
 */
function blocksFromInline(inline: PmNode[]): PmNode[] {
  const out: PmNode[] = []
  let run: PmNode[] = []
  const flush = () => {
    if (run.length === 0) return
    // Drop a run that is only whitespace text (e.g. the spaces around a block image).
    const meaningful = run.some((n) => n.type !== 'text' || (n.text ?? '').trim() !== '')
    if (meaningful) out.push({ type: 'paragraph', content: run })
    run = []
  }
  for (const n of inline) {
    if (n.type === 'image' || n.type === 'blockMath') {
      flush()
      out.push(n) // block-level node (image / display math): lift out of the inline run
    } else {
      run.push(n)
    }
  }
  flush()
  return out
}

// ── Lists ────────────────────────────────────────────────────────────────────

function takeList(
  tokens: Token[],
  openIdx: number,
  kind: 'bulletList' | 'orderedList',
  ctx: Ctx,
): { node: PmNode; next: number } {
  const closeType = kind === 'bulletList' ? 'bullet_list_close' : 'ordered_list_close'
  const openType = kind === 'bulletList' ? 'bullet_list_open' : 'ordered_list_open'
  const end = matchClose(tokens, openIdx, openType, closeType)

  const items: PmNode[] = []
  let taskListDetected = false
  let j = openIdx + 1
  while (j < end) {
    if (tokens[j].type === 'list_item_open') {
      const itemEnd = matchClose(tokens, j, 'list_item_open', 'list_item_close')
      const itemBlocks = mapBlockTokens(tokens.slice(j + 1, itemEnd), ctx)
      const task = extractTask(itemBlocks)
      if (task.isTask) {
        taskListDetected = true
        items.push({ type: 'taskItem', attrs: { checked: task.checked }, content: task.content })
      } else {
        items.push({ type: 'listItem', content: itemBlocks.length ? itemBlocks : [{ type: 'paragraph' }] })
      }
      j = itemEnd + 1
    } else {
      j += 1
    }
  }

  // If any item is a task item, the whole list becomes a taskList (matches export's taskList).
  if (taskListDetected) {
    const normalized = items.map((it) =>
      it.type === 'taskItem'
        ? it
        : { type: 'taskItem', attrs: { checked: false }, content: it.content },
    )
    return { node: { type: 'taskList', content: normalized }, next: end + 1 }
  }
  if (kind === 'orderedList') {
    // Preserve a non-default start index (`5. …` → start:5) so the rendered numbering matches
    // the source; markdown-it exposes it on the ordered_list_open token's attrs.
    const start = orderedListStart(tokens[openIdx])
    const attrs = start != null && start !== 1 ? { start } : undefined
    return { node: attrs ? { type: kind, attrs, content: items } : { type: kind, content: items }, next: end + 1 }
  }
  return { node: { type: kind, content: items }, next: end + 1 }
}

/** Read the `start` attribute markdown-it sets on an ordered_list_open token (e.g. `5. …`). */
function orderedListStart(openTok: Token): number | null {
  const attrs = openTok.attrs
  if (!attrs) return null
  for (const [k, v] of attrs) {
    if (k === 'start') {
      const n = typeof v === 'number' ? v : parseInt(String(v), 10)
      return Number.isFinite(n) ? n : null
    }
  }
  return null
}

/**
 * Detect a task-list checkbox prefix inside the item's first paragraph.
 *
 * Only the bracketed GFM-style checkbox counts as a task marker, so a normal
 * bullet whose text merely starts with a check/cross emoji is NOT misread as a
 * task item. Within the brackets we accept the ASCII `x`/`X` plus common
 * check glyphs some editors emit, and treat any non-space bracket content as
 * checked:
 *   checked:   [x] [X] [✓] [✔] [√]
 *   unchecked: [ ]
 */
function extractTask(blocks: PmNode[]): { isTask: boolean; checked: boolean; content: PmNode[] } {
  const first = blocks[0]
  if (first?.type === 'paragraph' && first.content && first.content.length) {
    const firstInline = first.content[0]
    if (firstInline?.type === 'text' && typeof firstInline.text === 'string') {
      // Bracketed checkbox only: [ ] (unchecked) / [x] [X] [✓] [✔] [√] (checked).
      const m = /^\[([ xX✓✔√])\]\s+/.exec(firstInline.text)
      if (m) {
        const checked = m[1] !== ' '
        const stripped = firstInline.text.slice(m[0].length)
        const newContent = [...blocks]
        const newFirstInline = stripped
          ? [{ ...firstInline, text: stripped }, ...first.content.slice(1)]
          : first.content.slice(1)
        newContent[0] = { ...first, content: newFirstInline }
        return { isTask: true, checked, content: newContent }
      }
    }
  }
  return { isTask: false, checked: false, content: blocks }
}

// ── Tables ────────────────────────────────────────────────────────────────────

function mapTable(inner: Token[], ctx: Ctx): PmNode {
  const rows: PmNode[] = []
  let i = 0
  let isHeaderSection = false
  while (i < inner.length) {
    const t = inner[i]
    if (t.type === 'thead_open') { isHeaderSection = true; i++; continue }
    if (t.type === 'thead_close') { isHeaderSection = false; i++; continue }
    if (t.type === 'tbody_open' || t.type === 'tbody_close') { i++; continue }
    if (t.type === 'tr_open') {
      const trEnd = matchClose(inner, i, 'tr_open', 'tr_close')
      const cells: PmNode[] = []
      let j = i + 1
      while (j < trEnd) {
        if (inner[j].type === 'th_open' || inner[j].type === 'td_open') {
          const isHeader = inner[j].type === 'th_open'
          const closeType = isHeader ? 'th_close' : 'td_close'
          const cellEnd = matchClose(inner, j, inner[j].type, closeType)
          const inlineTok = inner.slice(j + 1, cellEnd).find((x) => x.type === 'inline')
          const cellInline = inlineTok ? mapInline(inlineTok, ctx) : []
          // A cell may hold block images too (e.g. `| ![](url) |`). Wrapping a block image in
          // the cell's paragraph is schema-invalid and the image silently vanishes, so split
          // the inline run into proper block children (image blocks + paragraphs). tableCell
          // content is block+, so an empty cell still needs one paragraph.
          const cellBlocks = blocksFromInline(cellInline)
          cells.push({
            type: isHeader ? 'tableHeader' : 'tableCell',
            content: cellBlocks.length ? cellBlocks : [{ type: 'paragraph' }],
          })
          j = cellEnd + 1
        } else j++
      }
      rows.push({ type: 'tableRow', content: cells })
      i = trEnd + 1
    } else i++
  }
  return { type: 'table', content: rows }
}

// ── Inline ─────────────────────────────────────────────────────────────────--

function mapInline(inlineTok: Token, ctx: Ctx): PmNode[] {
  const children = inlineTok.children ?? []
  const out: PmNode[] = []
  const markStack: Array<{ type: string; attrs?: Record<string, unknown> }> = []

  for (let i = 0; i < children.length; i++) {
    const c = children[i]
    switch (c.type) {
      case 'text':
        if (c.content) out.push(withMarks({ type: 'text', text: c.content }, markStack))
        break
      case 'softbreak':
        out.push(withMarks({ type: 'text', text: ' ' }, markStack))
        break
      case 'hardbreak':
        out.push({ type: 'hardBreak' })
        break
      case 'code_inline':
        out.push(withMarks({ type: 'text', text: c.content }, [...markStack, { type: 'code' }]))
        break
      case 'strong_open': markStack.push({ type: 'bold' }); break
      case 'strong_close': popMark(markStack, 'bold'); break
      case 'em_open': markStack.push({ type: 'italic' }); break
      case 'em_close': popMark(markStack, 'italic'); break
      case 's_open': markStack.push({ type: 'strike' }); break
      case 's_close': popMark(markStack, 'strike'); break
      case 'link_open': {
        const href = c.attrGet('href')
        const safe = isSafeHref(href)
        if (safe) markStack.push({ type: 'link', attrs: { href: safe } })
        else markStack.push({ type: '__dropped_link' })
        break
      }
      case 'link_close': popMark(markStack, 'link', '__dropped_link'); break
      case 'image': {
        const node = mapImage(c, ctx)
        if (node) out.push(withMarks(node, markStack))
        break
      }
      case 'html_inline': {
        const res = parseInlineHtml(c.content, markStack)
        if (res.textNode) out.push(withMarks(res.textNode, markStack))
        // open/close of whitelisted inline HTML marks handled inside parseInlineHtml via markStack mutation
        break
      }
      case 'math_inline':
        // Real inline math from the dollar-math inline rule (raw LaTeX preserved).
        out.push({ type: 'inlineMath', attrs: { latex: c.content.trim() } })
        break
      case 'math_block':
        // `$$…$$` written inline still maps to a blockMath node (matches export).
        out.push({ type: 'blockMath', attrs: { latex: c.content.trim() } })
        break
      default:
        // Detect inline `$…$` math and `:emoji:` inside plain runs is done at text level;
        // unknown inline tokens with content become text.
        if (c.content) out.push(withMarks({ type: 'text', text: c.content }, markStack))
    }
  }
  return postProcessInline(out, ctx)
}

function withMarks(
  node: PmNode,
  stack: Array<{ type: string; attrs?: Record<string, unknown> }>,
): PmNode {
  const marks = stack.filter((m) => m.type !== '__dropped_link')
  if (node.type === 'text' && marks.length) return { ...node, marks: marks.map((m) => ({ ...m })) }
  return node
}

function popMark(stack: Array<{ type: string }>, ...types: string[]): void {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (types.includes(stack[i].type)) { stack.splice(i, 1); return }
  }
}

function mapImage(tok: Token, ctx: Ctx): PmNode | null {
  const src = tok.attrGet('src') ?? ''
  const alt = tok.content || tok.attrGet('alt') || ''
  const title = tok.attrGet('title') || ''
  // Check original src for network URL (not resolved — isSafeHref resolves relative URLs
  // against a dummy base, making ./foo.png look like https://safe.local/foo.png).
  const isNetwork = /^https?:\/\//i.test(src.trim())
  if (!isNetwork) {
    // Local / data: / relative / unsafe image — can't import. Degrade to text marker (§6.1 b).
    ctx.localImageCount += 1
    return {
      type: 'text',
      text: tr(ctx.opts, 'docs.import.imageNotImported', { name: alt || src || '' }),
    }
  }
  const safe = isSafeHref(src)
  if (!safe) {
    // Network URL but failed safety check (e.g. javascript: disguised)
    ctx.localImageCount += 1
    return {
      type: 'text',
      text: tr(ctx.opts, 'docs.import.imageNotImported', { name: alt || src || '' }),
    }
  }
  const attrs: Record<string, unknown> = { src: safe }
  // Recover the durable attachId from our own storage URL scheme
  // (`.../file/<docId>/att_<id>/<name>?<signature>`). The signed `src` is short-lived
  // (`X-Amz-Expires`), so on a same-system round-trip we MUST keep the attachId or the image
  // silently vanishes once the signature expires. The editor re-resolves a fresh URL from it.
  const attachId = extractAttachId(src)
  if (attachId) attrs.attachId = attachId
  if (alt) attrs.alt = alt
  if (title) attrs.title = title
  return { type: 'image', attrs }
}

/**
 * Pull the durable attachId out of an export storage URL. Our exporter emits image src as a
 * signed URL whose path contains an `att_<hex>` segment (`/file/<docId>/att_<id>/<file>`).
 * Returns the `att_...` id when present, else null (external images keep only their src).
 */
function extractAttachId(src: string): string | null {
  const m = /\/(att_[A-Za-z0-9]+)(?:\/|\?|$)/.exec(src)
  return m ? m[1] : null
}

/**
 * Post-process a run of inline nodes to extract inline math (`$…$`) and emoji (`:name:`)
 * from plain text runs. Splits text nodes, preserving marks on the surrounding text.
 */
function postProcessInline(nodes: PmNode[], ctx: Ctx): PmNode[] {
  const out: PmNode[] = []
  for (const n of nodes) {
    if (n.type !== 'text' || !n.text || (n.marks ?? []).some((m) => m.type === 'code')) {
      out.push(n)
      continue
    }
    out.push(...splitMathAndEmoji(n, ctx))
  }
  return out
}

// Inline math `$…$`, using the CommonMark/pandoc dollar-math boundary rules so currency like
// `$5` or a price range `$5 到 $9` is NOT swallowed:
//   - the opening `$` must not be followed by whitespace or a digit,
//   - the closing `$` must not be preceded by whitespace, and must not be followed by a digit.
// The content itself still excludes `$` and newlines.
const INLINE_MATH_RE = /\$(?![\s\d])([^$\n]*[^$\n\s])\$(?!\d)/g
const EMOJI_RE = /:([a-z0-9_+-]+):/gi
// `==text==` highlight (GFM-ish; used by Typora/Obsidian). CommonMark has no mark rule and our
// exporter emits `<mark>` HTML, but external files commonly use `==…==`, so support both.
const HIGHLIGHT_RE = /==([^=\n]+)==/g

function splitMathAndEmoji(textNode: PmNode, ctx: Ctx): PmNode[] {
  const text = textNode.text ?? ''
  const marks = textNode.marks
  // Split order: highlight (==…==) → inline math ($…$) → emoji (:name:). Highlight adds a mark
  // to the enclosed text and lets math/emoji still resolve inside it.
  const pieces: PmNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  HIGHLIGHT_RE.lastIndex = 0
  while ((m = HIGHLIGHT_RE.exec(text))) {
    if (m.index > last) splitMath(pieces, text.slice(last, m.index), marks, ctx)
    const hlMarks = addMark(marks, 'highlight')
    splitMath(pieces, m[1], hlMarks, ctx)
    last = m.index + m[0].length
  }
  if (last < text.length) splitMath(pieces, text.slice(last), marks, ctx)
  return pieces
}

/** Append `type` to a marks list (deduped), returning a new array. */
function addMark(marks: PmNode['marks'], type: string): PmNode['marks'] {
  const base = marks ? marks.map((x) => ({ ...x })) : []
  if (!base.some((x) => x.type === type)) base.push({ type })
  return base
}

/** Split a text run on inline math, then hand remaining text to emoji splitting. */
function splitMath(out: PmNode[], text: string, marks: PmNode['marks'], ctx: Ctx): void {
  if (!text) return
  let last = 0
  let m: RegExpExecArray | null
  INLINE_MATH_RE.lastIndex = 0
  while ((m = INLINE_MATH_RE.exec(text))) {
    if (m.index > last) pushText(out, text.slice(last, m.index), marks, ctx)
    out.push({ type: 'inlineMath', attrs: { latex: m[1].trim() } })
    last = m.index + m[0].length
  }
  if (last < text.length) pushText(out, text.slice(last), marks, ctx)
}

function pushText(
  out: PmNode[],
  text: string,
  marks: PmNode['marks'],
  ctx: Ctx,
): void {
  if (!text) return
  let last = 0
  let m: RegExpExecArray | null
  EMOJI_RE.lastIndex = 0
  while ((m = EMOJI_RE.exec(text))) {
    const name = m[1]
    // Only convert `:name:` to an emoji node when a resolver confirms it maps to a real glyph.
    // Without a resolver we can't tell `:smile:` from `:not_a_real_thing:`, so keep the literal
    // text (the exporter round-trips unknown shortcodes as text anyway) rather than emit an
    // emoji node that renders blank.
    const known = ctx.opts.emojiName ? Boolean(ctx.opts.emojiName(name)) : false
    if (known) {
      if (m.index > last) emitText(out, text.slice(last, m.index), marks)
      out.push({ type: 'emoji', attrs: { name } })
      last = m.index + m[0].length
    }
  }
  if (last < text.length) emitText(out, text.slice(last), marks)
}

function emitText(out: PmNode[], text: string, marks: PmNode['marks']): void {
  if (!text) return
  const node: PmNode = { type: 'text', text }
  if (marks && marks.length) node.marks = marks.map((x) => ({ ...x }))
  out.push(node)
}

/** Helper for html-inline to turn a raw text fragment into inline PM nodes. */
function mapInlineHtmlText(text: string, ctx: Ctx): PmNode[] {
  return [{ type: 'text', text }]
}

// Re-export the block-math paragraph detector so tests can exercise it.
export { detectBlockMath }
