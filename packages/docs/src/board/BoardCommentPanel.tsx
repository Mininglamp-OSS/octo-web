import { useEffect, useMemo, useRef, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { canComment, canEdit, canManage } from '../auth/roles.ts'
import { getCurrentUid, t } from '../octoweb/index.ts'
import { formatAbsolute, formatRelative } from '../versions/format.ts'
import { MentionComposer } from '../mentions/MentionComposer.tsx'
import { MentionText } from '../mentions/MentionText.tsx'
import type { Comment, CommentThread } from '../comments/api.ts'
import type { UseDocComments } from '../comments/useDocComments.ts'
import {
  boardAnchorLabel,
  boardElementTypeLabelKey,
  decodeBoardCommentAnchor,
  encodeBoardCommentAnchor,
  type BoardCommentAnchor,
} from './boardCommentAnchor.ts'

export interface BoardAnchorTarget {
  anchor: BoardCommentAnchor
  label: string
}

function CommentBody({
  comment,
  role,
  comments,
  names,
}: {
  comment: Comment
  role: Role
  comments: UseDocComments
  names: Map<string, string>
}) {
  const currentUid = getCurrentUid()
  const isAuthor = currentUid === comment.authorUid
  const hardDelete = !isAuthor && canManage(role)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  async function save() {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    setMutationError(null)
    try {
      const result = await comments.editBody(comment.id, body)
      if (result.ok) setEditing(false)
      else setMutationError(result.error)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : t('docs.state.error'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm(t('docs.comment.deleteConfirm'))) return
    setBusy(true)
    setMutationError(null)
    try {
      const result = await comments.remove(comment.id, hardDelete)
      if (!result.ok) setMutationError(result.error)
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : t('docs.state.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="octo-comment-body">
      <div className="octo-comment-head">
        <span className="octo-uid">{names.get(comment.authorUid) || comment.authorUid}</span>
        <span className="octo-comment-time" title={formatAbsolute(comment.createdAt)}>
          {formatRelative(comment.createdAt)}
        </span>
      </div>
      {editing ? (
        <div className="octo-comment-compose">
          <textarea
            className="octo-comment-input"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
          {mutationError && <p className="octo-member-error" role="alert">{mutationError}</p>}
          <div className="octo-comment-compose-actions">
            <button type="button" className="octo-tb-btn" disabled={busy || !draft.trim()} onClick={() => void save()}>
              {t('docs.comment.save')}
            </button>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={busy}
              onClick={() => {
                setDraft(comment.body)
                setEditing(false)
              }}
            >
              {t('docs.comment.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <p className="octo-comment-text"><MentionText body={comment.body} names={names} /></p>
      )}
      {!editing && mutationError && <p className="octo-member-error" role="alert">{mutationError}</p>}
      {!editing && (isAuthor || hardDelete) && (
        <div className="octo-comment-actions">
          {isAuthor && (
            <button type="button" className="octo-tb-btn" onClick={() => setEditing(true)}>
              {t('docs.comment.edit')}
            </button>
          )}
          <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => void remove()}>
            {t('docs.comment.delete')}
          </button>
        </div>
      )}
    </div>
  )
}

function BoardThread({
  thread,
  role,
  comments,
  names,
  active,
  onActivate,
  elementType,
}: {
  thread: CommentThread
  role: Role
  comments: UseDocComments
  names: Map<string, string>
  active: boolean
  onActivate: () => void
  elementType?: string
}) {
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [threadActionError, setThreadActionError] = useState<string | null>(null)
  const [replyError, setReplyError] = useState<string | null>(null)
  const itemRef = useRef<HTMLLIElement>(null)
  const anchor = decodeBoardCommentAnchor(thread.anchorStart)
  const localizedAnchorLabel = anchor?.kind === 'element'
    ? `${t('docs.board.comment.element')} · ${t(boardElementTypeLabelKey(elementType))}`
    : anchor ? `${t('docs.board.comment.point')} · ${boardAnchorLabel(anchor)}` : ''

  useEffect(() => {
    if (active) itemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  async function sendReply() {
    const body = reply.trim()
    if (!body || busy) return
    setBusy(true)
    setReplyError(null)
    try {
      const result = await comments.reply(thread.id, body)
      if (result.ok) {
        setReply('')
        setReplying(false)
      } else setReplyError(result.error)
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : t('docs.state.error'))
    } finally {
      setBusy(false)
    }
  }

  async function toggleResolved() {
    if (busy) return
    setBusy(true)
    setThreadActionError(null)
    try {
      const result = await comments.resolve(thread.id, !thread.resolved)
      if (!result.ok) setThreadActionError(result.error)
    } catch (error) {
      setThreadActionError(error instanceof Error ? error.message : t('docs.state.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li ref={itemRef} className={`octo-comment-thread${active ? ' is-selected' : ''}`}>
      <button type="button" className="octo-comment-anchor" onClick={onActivate}>
        {anchor ? (
          <span className="octo-comment-quote">
            {localizedAnchorLabel}
          </span>
        ) : (
          <span className="octo-comment-orphan">{t('docs.board.comment.orphaned')}</span>
        )}
        {thread.resolved && <span className="octo-comment-resolved-badge">{t('docs.comment.resolvedBadge')}</span>}
      </button>
      <CommentBody comment={thread} role={role} comments={comments} names={names} />
      {thread.replies.length > 0 && (
        <ul className="octo-comment-replies">
          {thread.replies.map((item) => (
            <li key={item.id}>
              <CommentBody comment={item} role={role} comments={comments} names={names} />
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
            onClick={() => void toggleResolved()}
          >
            {thread.resolved ? t('docs.comment.reopen') : t('docs.comment.resolve')}
          </button>
        )}
        {canComment(role) && !replying && (
          <button type="button" className="octo-tb-btn" onClick={() => setReplying(true)}>
            {t('docs.comment.reply')}
          </button>
        )}
      </div>
      {threadActionError && <p className="octo-member-error" role="alert">{threadActionError}</p>}
      {replying && (
        <div className="octo-comment-compose">
          <textarea
            className="octo-comment-input"
            value={reply}
            autoFocus
            placeholder={t('docs.comment.replyPlaceholder')}
            onChange={(event) => setReply(event.target.value)}
          />
          {replyError && <p className="octo-member-error" role="alert">{replyError}</p>}
          <div className="octo-comment-compose-actions">
            <button type="button" className="octo-tb-btn" disabled={busy || !reply.trim()} onClick={() => void sendReply()}>
              {t('docs.comment.reply')}
            </button>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={busy}
              onClick={() => {
                setReply('')
                setReplying(false)
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

export function BoardCommentPanel({
  role,
  comments,
  names,
  spaceId,
  activeCommentId,
  onActivate,
  getTarget,
  initialTarget,
  onInitialTargetConsumed,
  getElementType,
  onClose,
}: {
  role: Role
  comments: UseDocComments
  names: Map<string, string>
  spaceId?: string
  activeCommentId: number | null
  onActivate: (thread: CommentThread) => void
  getTarget: () => BoardAnchorTarget
  initialTarget?: BoardAnchorTarget | null
  onInitialTargetConsumed?: () => void
  getElementType: (elementId: string) => string | undefined
  onClose: () => void
}) {
  const [composing, setComposing] = useState(false)
  const [target, setTarget] = useState<BoardAnchorTarget | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)
  const { threads, loading, loadingThreadIds, error, nextCursor, includeResolved, setIncludeResolved, loadMore } = comments
  const loadingActiveThread = activeCommentId != null && loadingThreadIds.has(activeCommentId)

  useEffect(() => {
    if (!initialTarget) return
    setTarget(initialTarget)
    setComposing(true)
    onInitialTargetConsumed?.()
  }, [initialTarget, onInitialTargetConsumed])

  function startComment() {
    setTarget(getTarget())
    setComposing(true)
  }

  async function submit() {
    if (!target || !body.trim() || busy) return
    setBusy(true)
    setComposeError(null)
    try {
      const encoded = encodeBoardCommentAnchor(target.anchor)
      const result = await comments.createRoot({
        body: body.trim(),
        anchorStart: encoded,
        anchorEnd: encoded,
        anchorText: target.label.slice(0, 512),
      })
      if (result.ok) {
        setBody('')
        setComposing(false)
        setTarget(null)
      } else setComposeError(result.error)
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : t('docs.state.error'))
    } finally {
      setBusy(false)
    }
  }

  const elementTypes = useMemo(() => {
    const result = new Map<number, string | undefined>()
    for (const thread of threads) {
      const anchor = decodeBoardCommentAnchor(thread.anchorStart)
      result.set(thread.id, anchor?.kind === 'element' ? getElementType(anchor.elementId) : undefined)
    }
    return result
  }, [threads, getElementType])

  return (
    <section className="octo-comment-panel octo-board-comment-panel">
      <div className="octo-member-row">
        <h3>{t('docs.comment.title')}</h3>
        <label className="octo-comment-toggle">
          <input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} />
          {t('docs.comment.showResolved')}
        </label>
        <button type="button" className="octo-tb-btn" onClick={onClose}>
          {t('docs.comment.close')}
        </button>
      </div>

      {canComment(role) && (
        <div className="octo-comment-compose">
          {composing ? (
            <>
              <span className="octo-board-comment-target">{target?.label}</span>
              <MentionComposer
                spaceId={spaceId}
                autoFocus
                placeholder={t('docs.board.comment.placeholder')}
                onChange={setBody}
                onSubmit={() => void submit()}
              />
              {composeError && <p className="octo-member-error" role="alert">{composeError}</p>}
              <div className="octo-comment-compose-actions">
                <button type="button" className="octo-tb-btn" disabled={busy || !body.trim()} onClick={() => void submit()}>
                  {t('docs.comment.send')}
                </button>
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy}
                  onClick={() => {
                    setBody('')
                    setTarget(null)
                    setComposing(false)
                  }}
                >
                  {t('docs.comment.cancel')}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="octo-tb-btn" onClick={startComment}>
              {t('docs.board.comment.add')}
            </button>
          )}
        </div>
      )}

      {error && <p className="octo-member-error" role="alert">{error}</p>}
      {loadingActiveThread && <p className="octo-loading">{t('docs.comment.loading')}</p>}
      {loading && !loadingActiveThread && threads.length === 0 && <p className="octo-loading">{t('docs.comment.loading')}</p>}
      {!loading && !loadingActiveThread && threads.length === 0 && <p className="octo-comment-empty">{t('docs.board.comment.empty')}</p>}
      <ul className="octo-comment-list">
        {threads.map((thread) => (
          <BoardThread
            key={thread.id}
            thread={thread}
            role={role}
            comments={comments}
            names={names}
            active={activeCommentId === thread.id}
            onActivate={() => onActivate(thread)}
            elementType={elementTypes.get(thread.id)}
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
