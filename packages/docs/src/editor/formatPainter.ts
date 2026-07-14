import type { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import type { Mark } from '@tiptap/pm/model'

/**
 * Format painter (XIN-963): copy the inline formatting of one selection and paint it onto another.
 *
 * This is a pure inline-mark operation — it reads the textStyle-family marks (bold / italic /
 * underline / strike / inline-code / colour / highlight / font size + family / super- & subscript)
 * of the source selection and re-applies exactly that set to the target selection. It never touches
 * node structure, block types, alignment, links, or comment anchors, so it introduces no schema
 * changes and keeps the Yjs document shape untouched.
 */

/**
 * Inline mark types the painter is allowed to copy. An allowlist (not a denylist) so marks that are
 * NOT plain inline formatting — `link` (target-specific href) and the `octoCommentHighlight`
 * decoration — are never carried across text, and any future mark defaults to non-paintable.
 *
 * `textStyle` is the carrier mark for text colour, font size and font family (extension-text-style /
 * extension-color store those as its attrs), so copying the `textStyle` mark instance carries all
 * three at once.
 */
export const PAINTABLE_MARK_NAMES: readonly string[] = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'textStyle',
  'highlight',
  'superscript',
  'subscript',
]

function isPaintable(mark: Mark): boolean {
  return PAINTABLE_MARK_NAMES.includes(mark.type.name)
}

/**
 * Capture the paintable inline marks describing the current selection.
 *
 * - Collapsed cursor: the marks that would apply to typed text (stored marks, else the marks at the
 *   caret) — so the painter can be armed from a caret sitting inside formatted text.
 * - Range selection: the marks of the first inline (text) node in the range. This mirrors the common
 *   format-painter convention of copying the formatting at the start of the selection; a mixed-format
 *   selection paints its leading run's format rather than an ambiguous union.
 *
 * Returns a (possibly empty) array. An empty result is meaningful: it means "plain text", and
 * painting it onto a target strips that target's paintable formatting.
 */
export function capturePaintMarks(state: EditorState): Mark[] {
  const { from, to, empty, $from } = state.selection
  if (empty) {
    const marks = state.storedMarks ?? $from.marks()
    return marks.filter(isPaintable)
  }
  let found: readonly Mark[] | null = null
  state.doc.nodesBetween(from, to, (node) => {
    if (found) return false
    if (node.isText || node.isInline) {
      found = node.marks
      return false
    }
    return true
  })
  return (found ?? []).filter(isPaintable)
}

/**
 * Paint the captured marks onto the current (target) selection.
 *
 * Replaces the target's inline formatting: every paintable mark type is first removed across the
 * range, then each captured mark is applied. This makes painting deterministic — the target ends up
 * with exactly the source's inline format, not a union of the two. Block structure, alignment, links
 * and comment anchors are left untouched.
 *
 * No-op (returns false) when the target selection is empty, so a stray caret click never mutates the
 * document.
 */
export function applyPaintMarks(editor: Editor, marks: readonly Mark[]): boolean {
  const { from, to, empty } = editor.state.selection
  if (empty) return false
  return editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      // Find the target's `link` spans up front. The `code` mark declares `excludes: '_'`
      // (@tiptap/extension-code), so ProseMirror will not let `code` and `link` share a range:
      // adding `code` strips the link, and the exclusion is mutual, so a link can't be re-applied
      // on top of code either. The painter must never touch the target's links, so any captured
      // mark whose type excludes `link` (e.g. `code`) is applied only to the *non-linked* portions
      // of the range — the linked text keeps its href and simply does not receive that mark.
      const linkType = state.schema.marks.link
      const linkSpans: { from: number; to: number }[] = []
      if (linkType) {
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText && !node.isInline) return true
          if (node.marks.some((m) => m.type === linkType)) {
            const spanFrom = Math.max(from, pos)
            const spanTo = Math.min(to, pos + node.nodeSize)
            if (spanTo > spanFrom) linkSpans.push({ from: spanFrom, to: spanTo })
          }
          return true
        })
      }

      // The sub-ranges of [from, to] that carry no link — the complement of linkSpans.
      const unlinkedSpans: { from: number; to: number }[] = []
      let cursor = from
      for (const span of linkSpans.sort((a, b) => a.from - b.from)) {
        if (span.from > cursor) unlinkedSpans.push({ from: cursor, to: span.from })
        cursor = Math.max(cursor, span.to)
      }
      if (cursor < to) unlinkedSpans.push({ from: cursor, to })

      for (const name of PAINTABLE_MARK_NAMES) {
        const markType = state.schema.marks[name]
        if (markType) tr.removeMark(from, to, markType)
      }
      for (const mark of marks) {
        // A mark that excludes `link` (code) would strip the href; confine it to unlinked spans.
        if (linkType && linkSpans.length > 0 && mark.type.excludes(linkType)) {
          for (const span of unlinkedSpans) tr.addMark(span.from, span.to, mark)
        } else {
          tr.addMark(from, to, mark)
        }
      }
      return true
    })
    .run()
}
