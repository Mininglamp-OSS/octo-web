// octo-doc read-only comment rail + "让 AI 处理" entry (env ring 2b).
//
// Overlay-only: this panel sits BESIDE the sanitized read-only content (mounted at the 2b
// EXTENSION POINT in HtmlDocView). It NEVER injects into the sanitized HTML and never makes the
// doc editable — comments/replies are its own controls in its own rail. Data flows through the
// octo-doc backend (htmlDocComments), not the same-origin Yjs backend. UI structure mirrors
// ../comments/CommentPanel.tsx conventions but the data layer is independent.
//
// TRIGGER MODE C (explicit): posting a comment does NOT invoke the AI. Only a deliberate
// "让 AI 处理" click forwards an instruction to chat (openDocForward). The two are decoupled.

import { useCallback, useEffect, useRef, useState } from 'react'
import { canForwardToChat, openDocForward, t } from '../octoweb/index.ts'
import { avatarUrlForUid } from './htmlAvatar.ts'
import {
  createComment,
  formatCommentTime,
  listComments,
  type Anchor,
  type OctoDocAuthor,
  type OctoDocComment,
  type OctoDocCommentThread,
} from './htmlDocComments.ts'
import { buildAgentInstruction, truncateAnchorText, type AgentInstructionDoc } from './htmlDocAnchor.ts'

export interface HtmlDocCommentPanelProps {
  docId: string
  space: string
  /** commenter+ may compose root comments, 划词评论 and replies. reader is strictly read-only:
   *  the list still renders, but textarea / send / reply / selection-target controls are hidden. */
  mayComment?: boolean
  /** writer/admin may forward a thread to the AI (“让 AI 处理”). reader/commenter never see it. */
  mayEdit?: boolean
  slug: string
  /** Route selector used for listing comments (`latest` or `vN`). */
  listVersion: string
  /** Concrete version injected by the rendered document; required for mutations. */
  mutationVersion?: number | null
  /**
   * A pending selection anchor lifted from HtmlDocView's selection watcher. When set, the
   * composer pre-targets it (划词评论); cleared once the comment posts. null = doc-level note.
   */
  pendingAnchor?: Anchor | null
  /** Explicitly switches the composer back to a doc-level comment. */
  onClearPendingAnchor?: () => void
  /** Called after a successful post so the view can clear the floating "评论" affordance. */
  onPosted?: () => void
  /** Resolves the full anchored source text from the iframe document when available. */
  resolveAnchorText?: (anchor: Anchor | null | undefined) => string | null
}

/** Short human label for how a comment is anchored (element aid / selected text / doc-level). */
function anchorLabel(anchor: Anchor | null | undefined): string {
  if (!anchor) return t('docs.comment.anchorDoc')
  switch (anchor.kind) {
    case 'element':
      return `<${anchor.label ?? 'el'}> #${anchor.aid}`
    case 'text':
      return `“${anchor.text}”`
    case 'lost':
      return anchor.label
        ? t('docs.comment.anchorLostWithLabel', { values: { label: anchor.label } })
        : t('docs.comment.anchorLost')
    default:
      return t('docs.comment.anchorUnknown')
  }
}

function fallbackAnchorText(anchor: Anchor | null | undefined): string | null {
  return anchor?.kind === 'text' ? truncateAnchorText(anchor.text) : null
}

/** Display name for a comment author: name → login → anonymous fallback. */
function authorName(author: OctoDocAuthor | null | undefined): string {
  return author?.name || author?.login || t('docs.comment.anonymous')
}

/**
 * Resolve a comment author's avatar URL. Backend-supplied `avatar_url` wins; otherwise fall back
 * to the shared `/api/v1/users/<uid>/avatar` endpoint via avatarUrlForUid (same helper the header
 * ≡ menu uses for the doc creator). Order matters: never invert — an incoming avatar_url is the
 * only path that carries a non-avatar-endpoint image the panel must respect.
 */
function avatarUrlFor(author: OctoDocAuthor | null | undefined): string | null {
  if (author?.avatar_url) return author.avatar_url
  return avatarUrlForUid(author?.login)
}

/** Author + time line shown under each root comment and reply. */
function CommentMeta({ author, createdAt }: { author?: OctoDocAuthor | null; createdAt?: string | null }) {
  const name = authorName(author)
  const time = formatCommentTime(createdAt)
  const initial = name.slice(0, 1).toUpperCase()
  const avatarUrl = avatarUrlFor(author)
  // Fall back to the initial-letter chip if the avatar image fails to load (missing user / non-image).
  const [imgFailed, setImgFailed] = useState(false)
  const showImg = !!avatarUrl && !imgFailed
  return (
    <div className="octo-html-doc-comment-meta">
      {showImg ? (
        <img className="octo-avatar" src={avatarUrl} alt="" title={name} onError={() => setImgFailed(true)} />
      ) : (
        <span className="octo-avatar" title={name} aria-hidden="true">
          {initial}
        </span>
      )}
      <span className="octo-html-doc-comment-author">{name}</span>
      {time && <span className="octo-html-doc-comment-time">{time}</span>}
    </div>
  )
}

export function HtmlDocCommentPanel({
  docId,
  space,
  mayComment = false,
  mayEdit = false,
  slug,
  listVersion,
  mutationVersion,
  pendingAnchor,
  resolveAnchorText,
  onClearPendingAnchor,
  onPosted,
}: HtmlDocCommentPanelProps) {
  const [threads, setThreads] = useState<OctoDocCommentThread[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Per-thread reply state (commenter+): only one open reply box at a time.
  const [replyingToId, setReplyingToId] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)
  const reloadSeq = useRef(0)

  const reload = useCallback(async () => {
    const seq = ++reloadSeq.current
    try {
      const next = await listComments(slug, listVersion)
      if (seq !== reloadSeq.current) return
      setThreads(next)
      setError(null)
    } catch {
      if (seq !== reloadSeq.current) return
      setError(t('docs.state.error'))
    }
  }, [slug, listVersion])

  useEffect(() => {
    void reload()
    return () => { reloadSeq.current += 1 }
  }, [reload])

  // A concrete positive integer version is required for every mutation (PR #1096 contract:
  // list may use `latest`, mutations must target a concrete version). Shared by root + reply.
  function requireMutationVersion(): number | null {
    const version = mutationVersion
    if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
      setError(t('docs.comment.errorVersion'))
      return null
    }
    return version
  }

  async function submit() {
    if (!mayComment || draft.trim() === '') return
    const version = requireMutationVersion()
    if (version == null) return
    setBusy(true)
    try {
      await createComment(slug, {
        text: draft.trim(),
        version,
        anchor: pendingAnchor ?? null,
      })
      setDraft('')
      onPosted?.()
      await reload()
    } catch {
      setError(t('docs.state.error'))
    } finally {
      setBusy(false)
    }
  }

  function startReply(threadId: string) {
    setReplyingToId(threadId)
    setReplyDraft('')
  }

  function cancelReply() {
    setReplyingToId(null)
    setReplyDraft('')
  }

  async function submitReply(thread: OctoDocCommentThread) {
    if (!mayComment || replyDraft.trim() === '') return
    const version = requireMutationVersion()
    if (version == null) return
    setReplyBusy(true)
    try {
      // A reply carries parentId and NO anchor (contract is exclusive; the data layer enforces it).
      await createComment(slug, {
        text: replyDraft.trim(),
        version,
        parentId: thread.id,
      })
      cancelReply()
      await reload()
    } catch {
      // Keep the reply text so the user can retry.
      setError(t('docs.state.error'))
    } finally {
      setReplyBusy(false)
    }
  }

  // "让 AI 处理" bridge availability (feature #511 seam). Gated: the standalone /d/ page has no
  // host IM surface, so we disable the control there instead of rendering a dead button.
  const canForward = canForwardToChat()
  const instructionDoc: AgentInstructionDoc = { docId, slug, space, version: listVersion }

  function handleWithAI(thread: OctoDocCommentThread) {
    if (!canForward) return
    const { title, link } = buildAgentInstruction(instructionDoc, thread)
    // Reuse the existing forward bridge; host owns the WKSDK send. canGrant=false: this is an
    // instruction to the AI, not an access-grant flow.
    openDocForward({ docId, title, link, canGrant: false })
  }

  const forwardDisabledReason = canForward ? undefined : t('docs.forward.grantDisabledReason')

  return (
    <aside className="octo-html-doc-comments" data-testid="html-doc-comment-panel" aria-label={t('docs.comment.title')}>
      <div className="octo-html-doc-comments-head">{t('docs.comment.title')}</div>

      {error && (
        <div className="octo-html-doc-comments-error" role="alert">
          {error}
        </div>
      )}

      <ul className="octo-html-doc-comments-list">
        {threads.map((thread) => {
          const canResolveAnchor = thread.anchor?.kind === 'element' || thread.anchor?.kind === 'text'
          const quoteText = (canResolveAnchor ? resolveAnchorText?.(thread.anchor) : null) ?? fallbackAnchorText(thread.anchor)
          const label = anchorLabel(thread.anchor)

          return (
            <li key={thread.id} className="octo-html-doc-comment" data-testid="html-doc-comment">
              {quoteText ? (
                <blockquote className="octo-html-doc-comment-quote" data-testid="comment-quote" title={quoteText}>
                  {quoteText}
                </blockquote>
              ) : thread.anchor ? (
                <div className="octo-html-doc-comment-anchor" title={label}>
                  {label}
                </div>
              ) : null}
              <CommentMeta author={thread.author} createdAt={thread.created_at} />
              <p className="octo-html-doc-comment-text">{thread.text}</p>
              {thread.replies?.map((r: OctoDocComment) => (
                <div key={r.id} className="octo-html-doc-comment-reply">
                  <CommentMeta author={r.author} createdAt={r.created_at} />
                  <p className="octo-html-doc-comment-reply-text">{r.text}</p>
                </div>
              ))}
              {/* Reply (commenter+): inline composer under the thread. reader never sees it. */}
              {mayComment && replyingToId === thread.id ? (
                <div className="octo-html-doc-comment-reply-compose">
                  <textarea
                    className="octo-comment-input"
                    value={replyDraft}
                    placeholder={t('docs.comment.replyPlaceholder')}
                    onChange={(e) => setReplyDraft(e.target.value)}
                  />
                  <div className="octo-html-doc-comment-reply-actions">
                    <button
                      type="button"
                      className="octo-doc-primary-btn"
                      disabled={replyBusy || replyDraft.trim() === ''}
                      onClick={() => void submitReply(thread)}
                    >
                      {t('docs.comment.reply')}
                    </button>
                    <button type="button" className="octo-tb-btn" onClick={cancelReply}>
                      {t('docs.comment.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                mayComment && (
                  <button
                    type="button"
                    className="octo-tb-btn octo-html-doc-comment-reply-btn"
                    onClick={() => startReply(thread.id)}
                  >
                    {t('docs.comment.reply')}
                  </button>
                )
              )}
              {mayEdit && (
                <button
                  type="button"
                  className="octo-html-doc-comment-ai octo-doc-primary-btn"
                  disabled={!canForward}
                  title={forwardDisabledReason}
                  onClick={() => handleWithAI(thread)}
                >
                  {t('docs.comment.handleWithAI')}
                </button>
              )}
            </li>
          )
        })}
      </ul>

      {/* Composer (commenter+): reader is strictly read-only — the list above is enough, and the
          textarea / send / selection-target block is hidden entirely. */}
      {mayComment ? (
        <div className="octo-html-doc-comments-compose">
          <div className="octo-html-doc-comments-target" data-testid="pending-anchor">
            {pendingAnchor ? (
              <>
                <span>
                  {t('docs.comment.targetAnchor')}: {anchorLabel(pendingAnchor)}
                </span>
                <button type="button" className="octo-tb-btn octo-html-doc-comments-clear" onClick={onClearPendingAnchor}>
                  {t('docs.comment.clearAnchor')}
                </button>
              </>
            ) : (
              <span>{t('docs.comment.targetDoc')}</span>
            )}
          </div>
          <textarea
            className="octo-comment-input"
            value={draft}
            placeholder={t('docs.comment.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="button" className="octo-doc-primary-btn" disabled={busy || draft.trim() === ''} onClick={submit}>
            {t('docs.comment.send')}
          </button>
        </div>
      ) : (
        <p className="octo-html-doc-comments-readonly" role="note">
          {t('docs.comment.readOnlyHint')}
        </p>
      )}
    </aside>
  )
}
