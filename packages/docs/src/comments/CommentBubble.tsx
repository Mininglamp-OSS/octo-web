// Selection -> comment bubble (feature #3 §).
//
// A floating "Comment" affordance shown over any non-empty text selection (reader+, so it does NOT
// gate on editability — a read-only viewer may still comment). Clicking captures the selection
// range, encodes its Yjs anchors (anchor.ts) immediately while the selection is live, then prompts
// for the body and POSTs a root comment. A distinct pluginKey keeps it from clashing with the
// formatting BubbleMenu in Toolbar.tsx.

import { useState } from 'react'
import { BubbleMenu } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { encodeAnchorRange, type EncodedAnchor } from './anchor.ts'
import type { CreateRootInput } from './api.ts'

export function CommentBubble({
  editor,
  onCreate,
}: {
  editor: Editor
  onCreate: (input: CreateRootInput) => Promise<void>
}) {
  const [pending, setPending] = useState<EncodedAnchor | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startComposing() {
    const { from, to } = editor.state.selection
    const enc = encodeAnchorRange(editor, from, to)
    if (!enc) {
      setError('Could not anchor a comment here.')
      return
    }
    setError(null)
    setPending(enc)
    setBody('')
  }

  function cancel() {
    setPending(null)
    setBody('')
    setError(null)
  }

  async function submit() {
    if (!pending || body.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        body: body.trim(),
        anchorStart: pending.anchorStart,
        anchorEnd: pending.anchorEnd,
        anchorText: pending.anchorText,
      })
      cancel()
    } catch {
      setError('Failed to add comment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="octoCommentBubble"
      tippyOptions={{ duration: 100, placement: 'bottom' }}
      shouldShow={({ from, to }) => from !== to}
    >
      <div className="octo-comment-bubble">
        {pending ? (
          <div className="octo-comment-compose">
            <textarea
              className="octo-comment-input"
              placeholder="Add a comment…"
              value={body}
              autoFocus
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="octo-comment-compose-actions">
              <button
                type="button"
                className="octo-tb-btn"
                disabled={busy || body.trim() === ''}
                onClick={submit}
              >
                Comment
              </button>
              <button type="button" className="octo-tb-btn" disabled={busy} onClick={cancel}>
                Cancel
              </button>
            </div>
            {error && <p className="octo-member-error">{error}</p>}
          </div>
        ) : (
          <>
            <button type="button" className="octo-tb-btn" onClick={startComposing}>
              💬 Comment
            </button>
            {error && <span className="octo-member-error">{error}</span>}
          </>
        )}
      </div>
    </BubbleMenu>
  )
}
