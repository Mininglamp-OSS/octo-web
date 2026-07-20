// Comment panel (feature #3 §) — right-side drawer, mirrors MemberPanel / VersionPanel conventions.
//
// Lists comment threads (roots + nested replies) for the doc; supports reply (reader+),
// resolve/reopen (writer+), edit-own-body (author), delete (author soft / admin hard), an
// includeResolved toggle and cursor "load more" pagination. Clicking a thread selects and scrolls
// to its highlight in the live doc; a click on a highlight (decoration layer) activates its thread
// here. The live editor is read for anchoring/scroll only — never mutated for comment data.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/core'
import type { Role } from '../auth/roles.ts'
import { canComment, canEdit, canManage } from '../auth/roles.ts'
import { getCurrentUid, t } from '../octoweb/index.ts'
import { formatRelative, formatAbsolute } from '../versions/format.ts'
import { decodeRelPos, resolveAnchorRange, getYBinding } from './anchor.ts'
import type { Comment, CommentThread } from './api.ts'
import type { UseDocComments } from './useDocComments.ts'
import { MentionComposer } from '../mentions/MentionComposer.tsx'
import { MentionText } from '../mentions/MentionText.tsx'

/** Re-render on editor doc/selection changes so orphan status + scroll targets stay current. */
function useEditorTick(editor: Editor): void {
  useSyncExternalStore(
    (cb) => {
      editor.on('transaction', cb)
      return () => {
        editor.off('transaction', cb)
      }
    },
    () => editor.state.doc.content.size,
  )
}

function anchorRange(editor: Editor, c: Comment) {
  if (!c.anchorStart || !c.anchorEnd) return null
  try {
    return resolveAnchorRange(editor, decodeRelPos(c.anchorStart), decodeRelPos(c.anchorEnd))
  } catch {
    return null
  }
}

/** A single comment body with author-only inline edit + author/admin delete. */
function CommentBody({
  comment,
  currentUid,
  role,
  comments,
  names,
  spaceId,
}: {
  comment: Comment
  currentUid: string
  role: Role
  comments: UseDocComments
  names?: Map<string, string>
  spaceId?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [busy, setBusy] = useState(false)

  const isAuthor = comment.authorUid === currentUid
  const canHardDelete = !isAuthor && canManage(role)

  async function saveEdit() {
    if (busy) return
    if (draft.trim() === '') return
    setBusy(true)
    try {
      await comments.editBody(comment.id, draft.trim())
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    if (!window.confirm(t('docs.comment.deleteConfirm'))) return
    setBusy(true)
    try {
      await comments.remove(comment.id, canHardDelete)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="octo-comment-body">
      <div className="octo-comment-head">
        <span className="octo-uid">{names?.get(comment.authorUid) || comment.authorUid}</span>
        <span className="octo-comment-time" title={formatAbsolute(comment.createdAt)}>
          {formatRelative(comment.createdAt)}
        </span>
      </div>
      {editing ? (
        <div className="octo-comment-compose">
          <MentionComposer
            initialBody={comment.body}
            spaceId={spaceId}
            autoFocus
            onChange={setDraft}
            onSubmit={saveEdit}
            onCancel={() => {
              setEditing(false)
              setDraft(comment.body)
            }}
          />
          <div className="octo-comment-compose-actions">
            <button
              type="button"
              className="octo-tb-btn"
              disabled={busy || draft.trim() === ''}
              onClick={saveEdit}
            >
              {t('docs.comment.save')}
            </button>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={busy}
              onClick={() => {
                setEditing(false)
                setDraft(comment.body)
              }}
            >
              {t('docs.comment.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <p className="octo-comment-text">
          <MentionText body={comment.body} names={names} />
        </p>
      )}
      {!editing && (isAuthor || canHardDelete) && (
        <div className="octo-comment-actions">
          {isAuthor && (
            <button type="button" className="octo-tb-btn" onClick={() => setEditing(true)}>
              {t('docs.comment.edit')}
            </button>
          )}
          {(isAuthor || canHardDelete) && (
            <button type="button" className="octo-tb-btn" disabled={busy} onClick={onDelete}>
              {t('docs.comment.delete')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Thread({
  thread,
  editor,
  role,
  currentUid,
  comments,
  active,
  onSelect,
  names,
  spaceId,
}: {
  thread: CommentThread
  editor: Editor
  role: Role
  currentUid: string
  comments: UseDocComments
  active: boolean
  onSelect: () => void
  names?: Map<string, string>
  spaceId?: string
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [busy, setBusy] = useState(false)

  const ready = getYBinding(editor) != null
  const range = anchorRange(editor, thread)
  const orphaned = ready && thread.anchorStart != null && range == null
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function scrollToHighlight() {
    onSelect()
    if (!range) return
    editor.chain().setTextSelection(range).scrollIntoView().focus().run()
  }

  async function submitReply() {
    if (busy) return
    if (replyBody.trim() === '') return
    setBusy(true)
    try {
      await comments.reply(thread.id, replyBody.trim())
      setReplyBody('')
      setReplyOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li ref={ref} className={`octo-comment-thread${active ? ' is-selected' : ''}`}>
      <button type="button" className="octo-comment-anchor" onClick={scrollToHighlight}>
        {orphaned ? (
          <span className="octo-comment-orphan">{t('docs.comment.orphaned')}</span>
        ) : (
          <span className="octo-comment-quote">“{thread.anchorText || '…'}”</span>
        )}
        {thread.resolved && <span className="octo-comment-resolved-badge">{t('docs.comment.resolvedBadge')}</span>}
      </button>

      <CommentBody comment={thread} currentUid={currentUid} role={role} comments={comments} names={names} spaceId={spaceId} />

      {thread.replies.length > 0 && (
        <ul className="octo-comment-replies">
          {thread.replies.map((r) => (
            <li key={r.id}>
              <CommentBody comment={r} currentUid={currentUid} role={role} comments={comments} names={names} spaceId={spaceId} />
            </li>
          ))}
        </ul>
      )}

      <div className="octo-comment-actions">
        {canEdit(role) && (
          <button
            type="button"
            className="octo-tb-btn"
            disabled={busy}
            onClick={() => void comments.resolve(thread.id, !thread.resolved)}
          >
            {thread.resolved ? t('docs.comment.reopen') : t('docs.comment.resolve')}
          </button>
        )}
        {canComment(role) && !replyOpen && (
          <button type="button" className="octo-tb-btn" onClick={() => setReplyOpen(true)}>
            {t('docs.comment.reply')}
          </button>
        )}
      </div>

      {replyOpen && (
        <div className="octo-comment-compose">
          <MentionComposer
            spaceId={spaceId}
            placeholder={t('docs.comment.replyPlaceholder')}
            autoFocus
            onChange={setReplyBody}
            onSubmit={submitReply}
            onCancel={() => {
              setReplyOpen(false)
              setReplyBody('')
            }}
          />
          <div className="octo-comment-compose-actions">
            <button
              type="button"
              className="octo-tb-btn"
              disabled={busy || replyBody.trim() === ''}
              onClick={submitReply}
            >
              {t('docs.comment.reply')}
            </button>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={busy}
              onClick={() => {
                setReplyOpen(false)
                setReplyBody('')
              }}
            >
              {t('docs.comment.cancel')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Right-side comment drawer (feature #3 §). Visible to all roles (reader+). */
export function CommentPanel({
  role,
  editor,
  comments,
  activeCommentId,
  onSelectComment,
  names,
  spaceId,
  onClose,
}: {
  role: Role
  editor: Editor
  comments: UseDocComments
  activeCommentId: number | null
  onSelectComment: (id: number | null) => void
  names?: Map<string, string>
  spaceId?: string
  onClose?: () => void
}) {
  useEditorTick(editor)
  const currentUid = getCurrentUid()
  const { threads, loading, error, nextCursor, includeResolved, setIncludeResolved, loadMore } =
    comments

  return (
    <section className="octo-comment-panel">
      <div className="octo-member-row">
        <h3 style={{ flex: 1, margin: 0 }}>{t('docs.comment.title')}</h3>
        <label className="octo-comment-toggle">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(e) => setIncludeResolved(e.target.checked)}
          />
          {t('docs.comment.showResolved')}
        </label>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            {t('docs.comment.close')}
          </button>
        )}
      </div>

      {error && <p className="octo-member-error">{error}</p>}
      {loading && threads.length === 0 && <p className="octo-loading">{t('docs.comment.loading')}</p>}
      {!loading && threads.length === 0 && (
        <p className="octo-comment-empty">
          {t('docs.comment.empty')}
        </p>
      )}

      <ul className="octo-comment-list">
        {threads.map((t) => (
          <Thread
            key={t.id}
            thread={t}
            editor={editor}
            role={role}
            currentUid={currentUid}
            comments={comments}
            names={names}
            spaceId={spaceId}
            active={activeCommentId === t.id}
            onSelect={() => onSelectComment(t.id)}
          />
        ))}
      </ul>

      {nextCursor != null && (
        <button type="button" className="octo-tb-btn" disabled={loading} onClick={() => void loadMore()}>
          {t('docs.comment.loadMore')}
        </button>
      )}
    </section>
  )
}
