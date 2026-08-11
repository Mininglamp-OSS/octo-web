// Selection -> comment bubble (feature #3 §).
//
// A floating "Comment" affordance shown over any non-empty text selection (reader+, so it does NOT
// gate on editability — a read-only viewer may still comment). Clicking captures the selection
// range, encodes its Yjs anchors (anchor.ts) immediately while the selection is live, then prompts
// for the body and POSTs a root comment. A distinct pluginKey keeps it from clashing with the
// formatting BubbleMenu in Toolbar.tsx.

import { useState } from 'react'
import { BubbleMenu } from '@tiptap/react/menus'
import type { Editor } from '@tiptap/core'
import type { Role } from '../auth/roles.ts'
import { encodeAnchorRange, type EncodedAnchor } from './anchor.ts'
import { t } from '../octoweb/index.ts'
import type { CreateRootInput } from './api.ts'
import type { CommentMutationResult } from './useDocComments.ts'
import { MentionComposer } from '../mentions/MentionComposer.tsx'

export function CommentBubble({
  editor,
  onCreate,
  docId,
  spaceId,
  role,
}: {
  editor: Editor
  onCreate: (input: CreateRootInput) => Promise<CommentMutationResult>
  /**
   * The document being commented on. Decides which Bots may be @-mentioned (a Bot is only offerable
   * when it holds writer+ on THIS doc), so without it the @ menu lists no Bot at all. Required —
   * the shell always knows its docId, and a missed call site should be a type error, not silent.
   */
  docId: string
  spaceId?: string
  /**
   * Current document role of the CALLER. Gates whether Bot candidates appear in the @ menu at all
   * (mentions/botCandidates.ts canMentionBot). Omitting it is NOT a harmless default — it fails
   * CLOSED, so the selection bubble offered no Bot even to an admin. That made this surface — the
   * one the executable-comment flow is actually built around ("select a sentence, @Bot, ask for a
   * rewrite") — the only composer where @Bot silently did not work.
   */
  role?: Role
}) {
  const [pending, setPending] = useState<EncodedAnchor | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startComposing() {
    const { from, to } = editor.state.selection
    const enc = encodeAnchorRange(editor, from, to)
    if (!enc) {
      setError(t('docs.comment.errorAnchor'))
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
    if (busy) return
    if (!pending || body.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      const result = await onCreate({
        body: body.trim(),
        anchorStart: pending.anchorStart,
        anchorEnd: pending.anchorEnd,
        anchorText: pending.anchorText,
      })
      if (result.ok) cancel()
      else setError(result.error ?? t('docs.comment.errorAdd'))
    } catch {
      setError(t('docs.comment.errorAdd'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="octoCommentBubble"
      // `bottom` keeps this out of the formatting bubble's way (that one defaults to `top`), but
      // without an explicit offset Floating UI applies its default main-axis gap on top of the
      // selection's own line box — the button ended up a visible gap below the text, looking
      // detached from what you selected. 6px is the same snug gap the formatting bubble reads as.
      options={{ placement: 'bottom', offset: 6 }}
      shouldShow={({ from, to }) => from !== to}
    >
      <div className="octo-comment-bubble">
        {pending ? (
          <div className="octo-comment-compose">
            <MentionComposer
              docId={docId}
              spaceId={spaceId}
              role={role}
              placeholder={t('docs.comment.composePlaceholder')}
              autoFocus
              onChange={setBody}
              onSubmit={submit}
              onCancel={cancel}
            />
            <div className="octo-comment-compose-actions">
              <button
                type="button"
                className="octo-tb-btn"
                disabled={busy || body.trim() === ''}
                onClick={submit}
              >
                {t('docs.comment.commentButton')}
              </button>
              <button type="button" className="octo-tb-btn" disabled={busy} onClick={cancel}>
                {t('docs.comment.cancel')}
              </button>
            </div>
            {error && <p className="octo-member-error">{error}</p>}
          </div>
        ) : (
          <>
            <button type="button" className="octo-tb-btn" onClick={startComposing}>
              💬 {t('docs.comment.commentButton')}
            </button>
            {error && <span className="octo-member-error">{error}</span>}
          </>
        )}
      </div>
    </BubbleMenu>
  )
}
