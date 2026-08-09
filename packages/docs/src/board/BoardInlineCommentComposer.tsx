import { useState } from 'react'
import { MentionComposer } from '../mentions/MentionComposer.tsx'
import type { UseDocComments } from '../comments/useDocComments.ts'
import { t } from '../octoweb/index.ts'
import { encodeBoardCommentAnchor } from './boardCommentAnchor.ts'
import type { BoardAnchorTarget } from './BoardCommentPanel.tsx'

/** Inline board composer intentionally mirrors SheetCommentComposer's 230px popover. */
export function BoardInlineCommentComposer({
  target,
  left,
  top,
  dark,
  spaceId,
  comments,
  onClose,
}: {
  target: BoardAnchorTarget
  left: number
  top: number
  dark: boolean
  spaceId?: string
  comments: UseDocComments
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function submit() {
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    setSubmitError(null)
    try {
      const encoded = encodeBoardCommentAnchor(target.anchor)
      const result = await comments.createRoot({
        body: text,
        anchorStart: encoded,
        anchorEnd: encoded,
        anchorText: target.label.slice(0, 512),
      })
      if (result.ok) onClose()
      else setSubmitError(result.error)
    } catch (error) {
      setSubmitError(error instanceof Error && error.message
        ? error.message
        : t('docs.state.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="octo-board-inline-comment-composer octo-sheet-comment-composer"
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        position: 'absolute',
        left,
        top,
        zIndex: 25,
        width: 230,
        padding: 8,
        borderRadius: 6,
        background: dark ? '#2a2a2a' : '#fff',
        border: `1px solid ${dark ? '#444' : '#dadce0'}`,
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      }}
    >
      <div className="octo-board-inline-comment-target">{target.label}</div>
      <MentionComposer
        spaceId={spaceId}
        placeholder={t('docs.board.comment.placeholder')}
        autoFocus
        onChange={setBody}
        onSubmit={() => void submit()}
        onCancel={onClose}
      />
      {submitError && <p className="octo-member-error" role="alert">{submitError}</p>}
      <div className="octo-comment-compose-actions octo-board-inline-comment-actions">
        <button type="button" className="octo-tb-btn" disabled={busy || !body.trim()} onClick={() => void submit()}>
          {t('docs.sheet.comment.menu')}
        </button>
        <button type="button" className="octo-tb-btn" disabled={busy} onClick={onClose}>
          {t('docs.comment.cancel')}
        </button>
      </div>
    </div>
  )
}
