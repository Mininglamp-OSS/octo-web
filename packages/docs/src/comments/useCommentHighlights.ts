// Bridge from comment data -> the highlight decoration plugin (feature #3 §).
//
// Decodes the base64 Yjs RelativePositions of the current non-resolved roots and pushes them into
// the CommentHighlight plugin via its command. Re-runs whenever the editor or the comment set
// changes; the plugin itself remaps the anchors on every doc transaction, so this only needs to
// fire on set changes, not on every keystroke.

import { useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import { decodeRelPos } from './anchor.ts'
import type { CommentAnchor } from './CommentDecorations.ts'
import type { CommentThread } from './api.ts'

export function useCommentHighlights(editor: Editor | null, threads: CommentThread[]): void {
  useEffect(() => {
    if (!editor) return
    const anchors: CommentAnchor[] = []
    for (const t of threads) {
      if (t.resolved || !t.anchorStart || !t.anchorEnd) continue
      try {
        anchors.push({ id: t.id, start: decodeRelPos(t.anchorStart), end: decodeRelPos(t.anchorEnd) })
      } catch {
        // Malformed anchor — skip; the thread still shows in the panel (orphan list).
      }
    }
    editor.commands.setCommentAnchors(anchors)
  }, [editor, threads])
}
