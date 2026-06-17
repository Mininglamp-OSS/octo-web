// Comment highlight decoration layer (feature #3 §).
//
// A Tiptap extension whose ProseMirror plugin paints inline `octo-comment-highlight` decorations
// over the ranges of the live (non-resolved, non-orphan) comments. It is VIEW-ONLY, exactly like
// the collaboration caret layer: it never dispatches content steps and never writes to the Y.Doc,
// so it cannot fight y-sync. Decorations are derived state — recomputed from the comment anchors on
// every transaction (so they remap as the doc changes, local or remote) and whenever React pushes a
// new comment set.
//
// SINGLE SOURCE OF TRUTH: React owns the comment list. It decodes each root's anchors into Yjs
// RelativePositions and pushes them in via the `setCommentAnchors` command (a plugin-key setMeta).
// The plugin resolves those relative positions to live {from,to} ranges against the CURRENT ySync
// binding inside `apply`, so anchoring always reflects the latest document — no offsets are cached.
//
// Clicking a highlight activates that comment's thread: the plugin invokes the `onActivate`
// callback stored in extension storage (React sets it), keeping the wiring decoupled from how the
// editor was constructed. ProseMirror imports stay on @tiptap/pm (single instance; check:dedupe).
//
// Tiptap v3's Collaboration extension binds the Y.Doc via @tiptap/y-tiptap (its own fork of
// y-prosemirror), so we MUST read the ySync state through @tiptap/y-tiptap's `ySyncPluginKey` and
// remap with its `relativePositionToAbsolutePosition` — the standalone y-prosemirror package
// registers a DIFFERENT PluginKey, so its getState() would return undefined against the live
// editor and the highlights would silently never paint.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import * as Y from 'yjs'
import { ySyncPluginKey, relativePositionToAbsolutePosition } from '@tiptap/y-tiptap'

export const commentDecorationPluginKey = new PluginKey<CommentDecorationState>('octoCommentHighlight')

/** A comment root reduced to what the decoration layer needs: its id + decoded relative anchors. */
export interface CommentAnchor {
  id: number
  start: Y.RelativePosition
  end: Y.RelativePosition
}

interface CommentDecorationState {
  anchors: CommentAnchor[]
  decorations: DecorationSet
}

export interface CommentHighlightStorage {
  /** Set by React; invoked with a comment id when its highlight is clicked. */
  onActivate: ((id: number) => void) | null
}

function buildDecorations(anchors: CommentAnchor[], state: EditorState): DecorationSet {
  // ySync's binding/type are y-tiptap-internal; treat them opaquely at this boundary.
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const ystate = ySyncPluginKey.getState(state) as
    | { type?: any; doc?: Y.Doc; binding?: { mapping: any } } // eslint-disable-line @typescript-eslint/no-explicit-any
    | undefined
  if (!ystate || !ystate.binding || !ystate.type || !ystate.doc) return DecorationSet.empty
  const { doc, type, binding } = ystate
  const decorations: Decoration[] = []
  for (const a of anchors) {
    const from = relativePositionToAbsolutePosition(doc, type, a.start, binding.mapping)
    const to = relativePositionToAbsolutePosition(doc, type, a.end, binding.mapping)
    if (from == null || to == null) continue // orphan — no highlight (shown in the panel's orphan list)
    const lo = Math.min(from, to)
    const hi = Math.max(from, to)
    if (lo >= hi) continue // collapsed range — nothing to paint
    decorations.push(
      Decoration.inline(
        lo,
        hi,
        { class: 'octo-comment-highlight', 'data-comment-id': String(a.id) },
        { inclusiveStart: false, inclusiveEnd: false },
      ),
    )
  }
  return DecorationSet.create(state.doc, decorations)
}

export const CommentHighlight = Extension.create<Record<string, never>, CommentHighlightStorage>({
  name: 'octoCommentHighlight',

  addStorage() {
    return { onActivate: null }
  },

  addCommands() {
    return {
      // Push the current comment anchor set into the decoration plugin (view-only meta, no doc step).
      setCommentAnchors:
        (anchors: CommentAnchor[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(commentDecorationPluginKey, anchors))
          return true
        },
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin<CommentDecorationState>({
        key: commentDecorationPluginKey,
        state: {
          init: () => ({ anchors: [], decorations: DecorationSet.empty }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(commentDecorationPluginKey) as CommentAnchor[] | undefined
            const anchors = meta ?? value.anchors
            // Recompute when the anchor set changed or the doc moved (remap). Otherwise reuse.
            if (meta === undefined && !tr.docChanged) return value
            return { anchors, decorations: buildDecorations(anchors, newState) }
          },
        },
        props: {
          decorations(state) {
            return commentDecorationPluginKey.getState(state)?.decorations ?? DecorationSet.empty
          },
          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement | null
            const el = target?.closest('.octo-comment-highlight') as HTMLElement | null
            if (!el) return false
            const id = Number(el.getAttribute('data-comment-id'))
            if (!Number.isFinite(id)) return false
            editor.storage.octoCommentHighlight.onActivate?.(id)
            return true
          },
        },
      }),
    ]
  },
})

// Tiptap command + storage typing. v3 types `editor.storage` against a strict `Storage`
// interface (v2 typed it as Record<string, any>), so the extension's storage key must be
// declared here for `editor.storage.octoCommentHighlight` to type-check at the call sites.
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    octoCommentHighlight: {
      setCommentAnchors: (anchors: CommentAnchor[]) => ReturnType
    }
  }
  interface Storage {
    octoCommentHighlight: CommentHighlightStorage
  }
}
