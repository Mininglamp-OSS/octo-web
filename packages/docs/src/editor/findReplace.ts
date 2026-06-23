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
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export interface FindMatch {
  from: number
  to: number
}

export interface FindOptions {
  caseSensitive?: boolean
}

/**
 * Find every occurrence of `query` in the document, returning ProseMirror {from,to} ranges.
 *
 * Scans per text-block: the block's inline text is concatenated with a char→position map so a
 * match that spans adjacent text nodes (split by marks, e.g. bold inside a word) is still found
 * and mapped back to correct positions. Case-insensitive unless `caseSensitive` is set. An empty
 * query yields no matches.
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
      }
      // Inline atoms (e.g. images) contribute no searchable text; skipped in the map.
    })
    const haystack = caseSensitive ? text : text.toLowerCase()
    let idx = haystack.indexOf(needle)
    while (idx !== -1) {
      const from = map[idx]
      const to = map[idx + needle.length - 1] + 1
      if (from != null && to != null) matches.push({ from, to })
      idx = haystack.indexOf(needle, idx + needle.length)
    }
    return false // text block fully handled; don't descend into its inline children
  })
  return matches
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
