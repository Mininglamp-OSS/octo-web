// Self-built find & replace (toolbar item ⑪).
//
// A ProseMirror plugin that highlights all matches of a search term with inline decorations
// (the current match emphasized) and supports replace-current / replace-all. Decorations are a
// pure VIEW layer (never written to the Y.Doc, like the comment highlight / collaboration caret);
// replacements go through ordinary editor transactions, so collaboration syncs them normally.
//
// The match scanner (findMatches) is a pure function over a ProseMirror doc so the position
// mapping is unit-testable without a live editor.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export interface FindMatch {
  from: number
  to: number
}

export interface FindOptions {
  caseSensitive?: boolean
}

/**
 * A character that can never appear in a user query, pushed into the scan string in place of each
 * inline-atom node (emoji / mention / inline image / hard-break …). It breaks string contiguity at
 * the atom's position so `indexOf` can never produce a match that SPANS the atom — which would make
 * replaceCurrent/replaceAll's `insertText(from, to)` splice across (and silently delete) the atom
 * node (yujiawei P1 #2). It still occupies one slot in the position map so text positions on the
 * far side of an atom stay correctly mapped.
 */
const ATOM_BREAK = '\u0000'

/**
 * Find every occurrence of `query` in the document, returning ProseMirror {from,to} ranges.
 *
 * Scans per text-block: the block's inline text is concatenated with a char→position map so a
 * match that spans adjacent text nodes (split by marks, e.g. bold inside a word) is still found
 * and mapped back to correct positions. Inline atoms (emoji / mention / image …) are represented
 * by a non-matchable sentinel so a search can never match — nor replace — ACROSS an atom (which
 * would delete it). Case-insensitive unless `caseSensitive` is set. An empty query yields no matches.
 */
export function findMatches(doc: PMNode, query: string, opts: FindOptions = {}): FindMatch[] {
  const matches: FindMatch[] = []
  if (!query) return matches
  const caseSensitive = opts.caseSensitive ?? false
  const needle = caseSensitive ? query : query.toLowerCase()

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return undefined // keep descending toward text blocks
    // Build the block's inline text plus a map from each char index to its PM position.
    let text = ''
    const map: number[] = []
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        const start = pos + 1 + offset
        for (let i = 0; i < child.text.length; i++) {
          text += child.text[i]
          map.push(start + i)
        }
      } else {
        // Inline atom (emoji / mention / inline image / hard-break …): no searchable text, but it
        // occupies a document position. Emit a non-matchable sentinel so a match can't bridge the
        // gap and have insertText(from,to) splice across — and delete — the atom (yujiawei P1 #2).
        text += ATOM_BREAK
        map.push(pos + 1 + offset)
      }
    })
    const haystack = caseSensitive ? text : text.toLowerCase()
    let idx = haystack.indexOf(needle)
    while (idx !== -1) {
      const from = map[idx]
      const lastPos = map[idx + needle.length - 1]
      const to = lastPos + 1
      // Guard (belt-and-braces alongside the ATOM_BREAK sentinel): only accept a match whose
      // mapped positions are contiguous. A gap (last - first !== len - 1) means an inline atom
      // sits inside the range; replacing it would splice across and delete the atom (P1 #2).
      const contiguous = lastPos - from === needle.length - 1
      if (from != null && lastPos != null && contiguous) matches.push({ from, to })
      idx = haystack.indexOf(needle, idx + needle.length)
    }
    return false // text block fully handled; don't descend into its inline children
  })
  return matches
}

/**
 * Expand every collapsed `details` block that contains `pos`, so a match hidden inside a folded
 * (and possibly nested) details becomes visible before we scroll to it. Walks the ancestor chain
 * of `pos`; any details node whose `open` attr is false is set open in a single transaction
 * (handles nested folds — details inside details — by opening each level on the path).
 *
 * Pure over (state, dispatch): pass the editor's state + dispatch. Returns true if it opened at
 * least one details (the caller should then re-measure coords on the next frame, since opening
 * changes document height/layout), false if there was nothing to open.
 */
export function expandAncestorDetails(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  pos: number,
): boolean {
  const detailsType = state.schema.nodes.details
  if (!detailsType) return false // details extension not registered (e.g. minimal test editor)
  const clamped = Math.max(0, Math.min(pos, state.doc.content.size))
  let $pos
  try {
    $pos = state.doc.resolve(clamped)
  } catch {
    return false
  }

  // Collect the doc positions of every closed details ancestor on the path to `pos`.
  const toOpen: number[] = []
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (node.type === detailsType && !node.attrs.open) {
      toOpen.push($pos.before(depth))
    }
  }
  if (toOpen.length === 0) return false

  if (dispatch) {
    const tr = state.tr
    for (const at of toOpen) {
      const node = tr.doc.nodeAt(at)
      if (node && node.type === detailsType) {
        tr.setNodeMarkup(at, undefined, { ...node.attrs, open: true })
      }
    }
    // Don't disturb the find decorations/state; this is a pure layout-affecting edit.
    dispatch(tr)
  }
  return true
}

/**
 * Scroll the editor so the match at `pos` (a ProseMirror document position, e.g. a match's `from`)
 * is comfortably inside the visible viewport — fixing the bug where navigating (‹/›) to an
 * off-screen match advanced the counter but never brought the match into view.
 *
 * ProseMirror's built-in tr.scrollIntoView() only scrolls just enough to clip the cursor to the
 * viewport edge, so a match lands flush against (and behind) our sticky toolbar + find bar. We do
 * our own scroll instead: find the scroll container, measure the sticky header that overlaps the
 * top, and scroll the match to the vertical center of the *usable* area below that header. Works
 * for matches anywhere (off-screen, inside table cells, inside expanded details).
 *
 * Returns true if it scrolled (or the match was already comfortably visible), false if it could
 * not resolve the geometry (no live DOM — e.g. unit tests with a detached view).
 */
export function revealMatchInView(view: EditorView | null | undefined, pos: number): boolean {
  if (!view || typeof view.coordsAtPos !== 'function') return false
  let coords: { top: number; bottom: number; left: number; right: number }
  try {
    coords = view.coordsAtPos(pos)
  } catch {
    return false
  }
  if (!coords) return false

  // The scroll container is the editor pane (.octo-doc--editor); fall back to the nearest
  // scrollable ancestor of the editor DOM if the class ever changes.
  const dom = view.dom as HTMLElement
  const scroller = findScrollContainer(dom)
  if (!scroller) return false

  const scRect = scroller.getBoundingClientRect()
  // Height of any sticky header (toolbar + find bar) pinned at the top of the scroll container,
  // so we never scroll the match to where it would hide behind it. Measured live (the find bar
  // grows/shrinks with the replace row), with a small safety gap.
  const stickyOffset = measureStickyTop(scroller) + 12

  const usableTop = scRect.top + stickyOffset
  const usableBottom = scRect.bottom - 12
  const matchTop = coords.top
  const matchBottom = coords.bottom

  // Already fully inside the usable band → nothing to do (avoid jitter on adjacent matches).
  if (matchTop >= usableTop && matchBottom <= usableBottom) return true

  // Center the match within the usable band.
  const usableCenter = (usableTop + usableBottom) / 2
  const matchCenter = (matchTop + matchBottom) / 2
  const delta = matchCenter - usableCenter
  const maxScroll = scroller.scrollHeight - scroller.clientHeight
  const next = Math.max(0, Math.min(maxScroll, scroller.scrollTop + delta))
  scroller.scrollTo({ top: next, behavior: 'smooth' })
  return true
}

/** Find the closest scrollable ancestor (the editor pane), starting from the editor DOM. */
function findScrollContainer(from: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = from
  while (el) {
    const known = el.classList?.contains('octo-doc--editor')
    const style = el.ownerDocument?.defaultView?.getComputedStyle(el)
    const scrollable =
      style && /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight
    if (known || scrollable) return el
    el = el.parentElement
  }
  return null
}

/** Measure the combined height of sticky elements pinned to the top of the scroll container. */
function measureStickyTop(scroller: HTMLElement): number {
  // The toolbar + find bar live in .octo-toolbar-wrap (position: sticky; top: 0).
  const wrap = scroller.querySelector<HTMLElement>('.octo-toolbar-wrap')
  if (!wrap) return 0
  const r = wrap.getBoundingClientRect()
  return Math.max(0, r.height)
}

/** Plan a replace-all as right-to-left edits so earlier positions stay valid as we splice. */
export function planReplaceAll(matches: FindMatch[]): FindMatch[] {
  return [...matches].sort((a, b) => b.from - a.from)
}

export const findReplacePluginKey = new PluginKey<FindReplaceState>('octoFindReplace')

export interface FindReplaceState {
  query: string
  caseSensitive: boolean
  matches: FindMatch[]
  /** Index of the "current" match (the one Replace acts on); -1 when none. */
  index: number
  decorations: DecorationSet
}

const EMPTY: FindReplaceState = {
  query: '',
  caseSensitive: false,
  matches: [],
  index: -1,
  decorations: DecorationSet.empty,
}

function buildDecorations(doc: PMNode, matches: FindMatch[], index: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === index ? 'octo-find-match octo-find-match-current' : 'octo-find-match',
    }),
  )
  return DecorationSet.create(doc, decos)
}

/** Read the current find state for the React find bar (match count / index). */
export function getFindState(state: EditorState): FindReplaceState {
  return findReplacePluginKey.getState(state) ?? EMPTY
}

interface FindMeta {
  query?: string
  caseSensitive?: boolean
  index?: number
  /** Advance the current index by this delta (wraps around). */
  step?: number
  clear?: boolean
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      /** Set the search term (and optional case sensitivity); recomputes matches + decorations. */
      setFindQuery: (query: string, caseSensitive?: boolean) => ReturnType
      /** Move to the next match (wraps). */
      findNext: () => ReturnType
      /** Move to the previous match (wraps). */
      findPrev: () => ReturnType
      /** Replace the current match with `replacement` (no-op when there is none). */
      replaceCurrent: (replacement: string) => ReturnType
      /** Replace every match with `replacement`. */
      replaceAll: (replacement: string) => ReturnType
      /** Clear the search (removes all decorations). */
      clearFind: () => ReturnType
    }
  }
}

export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin<FindReplaceState>({
        key: findReplacePluginKey,
        state: {
          init: () => EMPTY,
          apply(tr, prev, _old, newState): FindReplaceState {
            const meta = tr.getMeta(findReplacePluginKey) as FindMeta | undefined
            let { query, caseSensitive, index } = prev

            if (meta?.clear) return EMPTY
            let dirty = tr.docChanged
            if (meta) {
              if (meta.query !== undefined && meta.query !== query) {
                query = meta.query
                dirty = true
              }
              if (meta.caseSensitive !== undefined && meta.caseSensitive !== caseSensitive) {
                caseSensitive = meta.caseSensitive
                dirty = true
              }
            }

            let matches = prev.matches
            if (dirty) {
              matches = findMatches(newState.doc, query, { caseSensitive })
            }

            // Resolve the new current index.
            if (meta?.index !== undefined) index = meta.index
            if (meta?.step !== undefined && matches.length > 0) {
              const base = index < 0 ? 0 : index
              index = (base + meta.step + matches.length) % matches.length
            }
            if (matches.length === 0) index = -1
            else if (index < 0) index = 0
            else if (index >= matches.length) index = matches.length - 1

            return {
              query,
              caseSensitive,
              matches,
              index,
              decorations: buildDecorations(newState.doc, matches, index),
            }
          },
        },
        props: {
          decorations(state) {
            return findReplacePluginKey.getState(state)?.decorations ?? DecorationSet.empty
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      setFindQuery:
        (query, caseSensitive) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const meta: FindMeta = { query }
            if (caseSensitive !== undefined) meta.caseSensitive = caseSensitive
            dispatch(tr.setMeta(findReplacePluginKey, meta))
          }
          return true
        },
      findNext:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findReplacePluginKey, { step: 1 } as FindMeta))
          return true
        },
      findPrev:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findReplacePluginKey, { step: -1 } as FindMeta))
          return true
        },
      replaceCurrent:
        (replacement) =>
        ({ state, dispatch }) => {
          const fs = findReplacePluginKey.getState(state)
          if (!fs || fs.index < 0 || !fs.matches[fs.index]) return false
          if (dispatch) {
            const m = fs.matches[fs.index]
            const tr = state.tr.insertText(replacement, m.from, m.to)
            // Keep searching from the same slot (the next match shifts into this index).
            tr.setMeta(findReplacePluginKey, { index: fs.index } as FindMeta)
            dispatch(tr)
          }
          return true
        },
      replaceAll:
        (replacement) =>
        ({ state, dispatch }) => {
          const fs = findReplacePluginKey.getState(state)
          if (!fs || fs.matches.length === 0) return false
          if (dispatch) {
            const tr = state.tr
            // Right-to-left so each splice leaves earlier match positions valid.
            for (const m of planReplaceAll(fs.matches)) {
              tr.insertText(replacement, m.from, m.to)
            }
            tr.setMeta(findReplacePluginKey, { index: -1 } as FindMeta)
            dispatch(tr)
          }
          return true
        },
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(findReplacePluginKey, { clear: true } as FindMeta))
          return true
        },
    }
  },
})
