// Pure helpers for ring 2b: build an octo-doc anchor from a DOM Selection, and build the
// "让 AI 处理" instruction payload. Kept side-effect-free (no fetch, no React) so they unit-test
// in isolation and are reused by both HtmlDocView (selection → anchor) and HtmlDocCommentPanel
// ("让 AI 处理" → openDocForward payload).

import type { Anchor } from './htmlDocComments.ts'
import type { OctoDocComment } from './htmlDocComments.ts'
import { t } from '../octoweb/index.ts'

/**
 * Robust CSS escaping for a hostile aid interpolated into an attribute selector: prefer the
 * platform CSS.escape, else escape every non-word char so quotes/brackets/backslashes cannot
 * break out of the selector.
 */
function escapeAidForSelector(value: string): string {
  const cssApi = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS
  if (cssApi?.escape) return cssApi.escape(value)
  return value.replace(/[^\w-]/g, (c) => `\\${c}`)
}

/** How much surrounding text to snapshot for a text anchor (drift re-location aid). */
const CONTEXT_CHARS = 40

// Cap anchor excerpts (comment quote) so a long selection/element never bloats the DOM/title.
const ANCHOR_TEXT_LIMIT = 120
export function truncateAnchorText(value: string): string {
  const chars = Array.from(value)
  if (chars.length <= ANCHOR_TEXT_LIMIT) return value
  return `${chars.slice(0, ANCHOR_TEXT_LIMIT).join('')}…`
}

/**
 * Walk up from a node to the nearest ancestor element carrying a stable `data-odoc-aid`.
 * Returns null if the selection is inside plain agent HTML with no aid on any ancestor.
 */
function closestAidElement(node: Node | null): Element | null {
  let el: Element | null =
    node == null
      ? null
      : node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement
  while (el) {
    if (el.hasAttribute('data-odoc-aid')) return el
    el = el.parentElement
  }
  return null
}

/**
 * Build an octo-doc anchor from the current DOM selection.
 *
 * Preference order (contract):
 *   1. ELEMENT anchor — if the selection's common ancestor resolves to an element with a
 *      `data-odoc-aid`, anchor to that stable id (`selector = [data-odoc-aid="{aid}"]`). This
 *      survives text edits within the element.
 *   2. TEXT anchor — otherwise anchor to the exact selected string plus a little surrounding
 *      context so octo-doc can re-locate it.
 *   3. null — nothing meaningfully selected (collapsed / whitespace-only).
 *
 * Pure: reads the Selection/Range but mutates nothing (never makes the doc editable).
 *
 * NOTE (kept intentionally, not dead): production selection capture now happens INSIDE the sandboxed
 * iframe via the bridge script's `anchorFromSelection` (buildBridgeScriptBody) — the parent can't read
 * the cross-origin doc's Selection. This TS function is the side-effect-free REFERENCE the bridge JS
 * mirrors 1:1 (element-aid preference, text + bounded context, collapse/whitespace → null); its unit
 * tests pin that contract so the two implementations cannot silently drift.
 */
export function buildAnchorFromSelection(sel: Selection | null): Anchor | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const selected = sel.toString()
  if (!selected.trim()) return null

  const range = sel.getRangeAt(0)
  // Prefer an element anchor when the selection sits inside an aid-bearing element.
  const aidEl = closestAidElement(range.commonAncestorContainer)
  if (aidEl) {
    const aid = aidEl.getAttribute('data-odoc-aid') as string
    return {
      kind: 'element',
      aid,
      selector: `[data-odoc-aid="${escapeAidForSelector(aid)}"]`,
      label: aidEl.tagName.toLowerCase(),
    }
  }

  // Text anchor: exact selection + bounded context from the surrounding text nodes.
  const anchor: Anchor = { kind: 'text', text: selected }
  const before = textAround(range, 'before')
  const after = textAround(range, 'after')
  if (before) anchor.context_before = before
  if (after) anchor.context_after = after
  return anchor
}

/** Grab up to CONTEXT_CHARS of text immediately before/after the selection within its container. */
function textAround(range: Range, side: 'before' | 'after'): string {
  const container =
    side === 'before' ? range.startContainer : range.endContainer
  const full = container.textContent ?? ''
  if (side === 'before') {
    const end = range.startOffset
    return full.slice(Math.max(0, end - CONTEXT_CHARS), end).trim()
  }
  const start = range.endOffset
  return full.slice(start, start + CONTEXT_CHARS).trim()
}

/** Minimal doc identity the instruction needs to point ring-3 back at the right document. */
export interface AgentInstructionDoc {
  docId: string
  slug?: string
  space?: string
  version?: string
}

/** The forward payload fragment (title + link) that lands in the chat message. */
export interface AgentInstruction {
  title: string
  link: string
}

/**
 * Build the "让 AI 处理" instruction message payload for a given comment.
 *
 * This is the message ring-3 (龙虾/AI) receives as its work order, so it MUST self-describe the
 * target: which doc (slug/docId + version), which anchor (element aid / selected text) and the
 * human's request (the comment body). Encoded into `link` as query params so the receiver can
 * parse it deterministically; `title` is the human-readable summary line.
 *
 * Pure: builds strings only. The actual send is openDocForward (host owns IM).
 */
export function buildAgentInstruction(
  doc: AgentInstructionDoc,
  comment: Pick<OctoDocComment, 'id' | 'text' | 'anchor'>,
): AgentInstruction {
  const slug = doc.slug ?? doc.docId
  const anchor = comment.anchor ?? null
  const target =
    anchor?.kind === 'element'
      ? `aid=${anchor.aid}`
      : anchor?.kind === 'text'
        ? `“${anchor.text}”`
        : 'whole-doc'

  const title = t('docs.comment.agentInstructionTitle', {
    values: { request: comment.text, slug, target },
  })
  const fallbackTitle =
    title === 'docs.comment.agentInstructionTitle'
      ? `docs.comment.agentInstructionTitle: ${comment.text} (doc ${slug} · ${target})`
      : title

  const params = new URLSearchParams({
    docId: doc.docId,
    slug,
    action: 'agent-handle-comment',
    commentId: comment.id,
    request: comment.text,
  })
  if (doc.version) params.set('version', doc.version)
  if (anchor?.kind === 'element') params.set('aid', anchor.aid)
  if (anchor?.kind === 'text') params.set('anchorText', anchor.text)

  return { title: fallbackTitle, link: `octo-doc://agent-handle?${params.toString()}` }
}
