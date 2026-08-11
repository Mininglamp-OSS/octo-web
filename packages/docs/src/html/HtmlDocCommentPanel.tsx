// octo-doc read-only comment rail + "让 AI 处理" entry (env ring 2b).
//
// Overlay-only: this panel sits BESIDE the sanitized read-only content (mounted at the 2b
// EXTENSION POINT in HtmlDocView). It NEVER injects into the sanitized HTML and never makes the
// doc editable — comments/replies are its own controls in its own rail. Data flows through the
// octo-doc backend (htmlDocComments), not the same-origin Yjs backend. UI structure mirrors
// ../comments/CommentPanel.tsx conventions but the data layer is independent.
//
// 触发方式:在评论里 @Bot。评论经 docs-backend 转发时识别 mention 并把任务入队,Bot 取到后
// 直接改这篇 HTML 并回到评论串里。原来那个「让 AI 处理」按钮(把指令转发进 IM 会话)已移除 ——
// @Bot 覆盖了它的全部用途,留着就是第二条入口,两条并存只会让人猜该点哪个。

import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../octoweb/index.ts'
import { avatarUrlForUid } from './htmlAvatar.ts'
import {
  createComment,
  deleteComment,
  formatCommentTime,
  listComments,
  type Anchor,
  type OctoDocAuthor,
  type OctoDocComment,
  type OctoDocCommentThread,
} from './htmlDocComments.ts'
import { truncateAnchorText } from './htmlDocAnchor.ts'
import { MentionComposer } from '../mentions/MentionComposer.tsx'
import { MentionText } from '../mentions/MentionText.tsx'
import type { Role } from '../auth/roles.ts'
// 评论栏与文档/表格对齐:直接复用它们的「AI 修改卡片」、折叠正文与 Bot 任务判定,
// 不在 HTML 侧另写一份 —— 那些规则踩过的坑都沉在 botTask.ts 的注释和用例里。
import { AgentExecutionCard } from '../comments/AgentExecutionCard.tsx'
import { CollapsibleText } from '../comments/CollapsibleText.tsx'
import { deriveBotThread } from '../comments/botTask.ts'
import { adaptHtmlComment, adaptHtmlThread, isHtmlAgentReply } from './htmlBotThread.ts'
import { useSpaceBotUids } from '../members/botUids.ts'
import { ContextMenu, useContextMenu } from '../ui/ContextMenu.tsx'
import { getCurrentUid } from '../octoweb/index.ts'

export interface HtmlDocCommentPanelProps {
  docId: string
  space: string
  /**
   * 当前用户在这篇文档上的角色。**必须传**:`@` 下拉的 Bot 分组按它做 fail-closed 判定
   * (要 writer+),拿不到角色就一个 Bot 都不列 —— 那样「@Bot 让它改文档」这条路等于没开。
   */
  role?: Role
  /**
   * uid → 显示名。用于把 mention token 和 AI 卡片标题渲染成人名而不是裸 uid。
   * 可选:缺失时 token 自带的 label 仍然能显示,只是不会跟随改名。
   */
  names?: Map<string, string>
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
    <div className="octo-comment-head octo-html-doc-comment-meta">
      {showImg ? (
        <img className="octo-avatar" src={avatarUrl} alt="" title={name} onError={() => setImgFailed(true)} />
      ) : (
        <span className="octo-avatar" title={name} aria-hidden="true">
          {initial}
        </span>
      )}
      <span className="octo-uid">{name}</span>
      {time && <span className="octo-comment-time">{time}</span>}
    </div>
  )
}

/**
 * 一条评论/回复的正文块,带右键菜单(删除)。
 *
 * 必须是独立组件:useContextMenu 是 hook,在 threads.map 的回调里调用会违反 hook 规则
 * (每条串的 hook 数量随渲染变化)。这也是文档/表格侧把 CommentBody 单独拆出来的原因。
 *
 * 「编辑」没放进来:HTML 后端的 PATCH /comments 只能改 anchor,改不了正文 —— 放一个
 * 点了不生效的菜单项比没有更糟。删除是后端真支持的(DELETE /comments)。
 */
function HtmlCommentBody({
  comment,
  names,
  lineLimit,
  canDelete,
  onDelete,
}: {
  comment: OctoDocComment
  names?: Map<string, string>
  lineLimit: number
  canDelete: boolean
  onDelete: () => void
}) {
  const menu = useContextMenu()
  const [busy, setBusy] = useState(false)
  return (
    <div className="octo-comment-body" tabIndex={0} {...menu.triggerProps}>
      <CommentMeta author={comment.author} createdAt={comment.created_at} />
      <CollapsibleText lineLimit={lineLimit}>
        <MentionText body={comment.text} names={names} />
      </CollapsibleText>
      <ContextMenu
        anchor={menu.anchor}
        onClose={menu.close}
        items={
          canDelete && !busy
            ? [
                {
                  key: 'delete',
                  label: t('docs.comment.delete'),
                  danger: true,
                  onSelect: () => {
                    setBusy(true)
                    // 交给调用方去 await + reload;这里只负责不重复触发。
                    onDelete()
                  },
                },
              ]
            : []
        }
      />
    </div>
  )
}

export function HtmlDocCommentPanel({
  docId,
  space,
  role,
  names,
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
  // MentionComposer 是非受控的(只读一次 initialBody),发帖后靠换 key 重挂载来清空。
  // 与 SheetCommentPanel 同一套做法。
  const [composerSeq, setComposerSeq] = useState(0)
  // Bot 名册:判定「这条串是不是 Bot 任务」的前提。首帧是空集合,那时一律判成非 Bot 串
  // (fail closed),名册到了自然重算 —— 不会把人类之间的讨论套上「AI 修改」的外壳。
  const botUids = useSpaceBotUids(space)
  // 回复框独立一份:清空根评论框不该把正在写的回复也抹掉,反之亦然。
  const [replySeq, setReplySeq] = useState(0)
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

  /**
   * 这条评论我能不能删。规则与后端 authorizeOwnCommentMutation 一致:
   * 自己发的,或在这篇文档上有 CapEdit 以上(mayEdit,即 writer/admin 能删别人的)。
   *
   * 前端算这个只为决定「显不显示菜单项」——**判定权仍在后端**,越权它回 403。
   * 算错的代价是多显示一个会失败的菜单项,而不是真的越权。
   */
  function mayDelete(c: OctoDocComment): boolean {
    if (mayEdit) return true
    const me = getCurrentUid()
    return me !== '' && c.author?.login === me
  }

  async function removeComment(id: string) {
    try {
      await deleteComment(slug, id)
      setError(null)
      await reload()
    } catch {
      setError(t('docs.state.error'))
    }
  }

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
      // 换 key 重挂载 composer —— setDraft('') 只清了状态,非受控编辑器里的文字还在。
      setComposerSeq((n) => n + 1)
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
    setReplySeq((n) => n + 1)
  }

  function cancelReply() {
    setReplyingToId(null)
    setReplyDraft('')
    setReplySeq((n) => n + 1)
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



  return (
    <aside
      // 只用自己的布局 class。**不要加 octo-comment-panel** —— 它带 margin-top:24px + 边框
      // + padding(styles.css:3061),在侧栏里会叠出第二层框;而评论行的样式来自
      // .octo-comment-thread / .octo-agent-* 这些,与面板 class 无关。
      className="octo-html-doc-comments"
      data-testid="html-doc-comment-panel"
      aria-label={t('docs.comment.title')}
    >
      <div className="octo-html-doc-comments-head">{t('docs.comment.title')}</div>

      {error && (
        <div className="octo-html-doc-comments-error" role="alert">
          {error}
        </div>
      )}

      <ul className="octo-html-doc-comments-list octo-comment-list">
        {threads.map((thread) => {
          const canResolveAnchor = thread.anchor?.kind === 'element' || thread.anchor?.kind === 'text'
          const quoteText = (canResolveAnchor ? resolveAnchorText?.(thread.anchor) : null) ?? fallbackAnchorText(thread.anchor)
          const label = anchorLabel(thread.anchor)
          // 复用文档/表格那套 Bot 任务判定,不另写一份 —— 规则的坑都沉在 botTask.ts 里。
          // anchorState 恒 'active':和表格同理,HTML 的引用失效由 octo-doc 发布时的锚点迁移
          // 负责,前端没有「相对位置漂了」这个概念可算。
          const botThread = deriveBotThread(adaptHtmlThread(thread), botUids, 'active')

          return (
            <li
              key={thread.id}
              className={`octo-comment-thread${botThread ? ' is-ai-edit' : ''}`}
              data-testid="html-doc-comment"
            >
              {/* ★ 引用块保持 HTML 自己的样式:三行截断 + 左侧竖线,是 HTML 特有的形态,
                  换成表格那个单行 chip 会把三行引用压成一行。testid 被测试断言,别动。 */}
              {quoteText ? (
                <blockquote className="octo-html-doc-comment-quote" data-testid="comment-quote" title={quoteText}>
                  {quoteText}
                </blockquote>
              ) : thread.anchor ? (
                <div className="octo-html-doc-comment-anchor" title={label}>
                  {label}
                </div>
              ) : null}
              <HtmlCommentBody
                comment={thread}
                names={names}
                lineLimit={5}
                canDelete={mayDelete(thread)}
                onDelete={() => void removeComment(thread.id)}
              />
              <ul className="octo-comment-replies">
                {thread.replies?.map((r: OctoDocComment) => {
                  const body = (
                    <HtmlCommentBody
                      comment={r}
                      names={names}
                      lineLimit={3}
                      canDelete={mayDelete(r)}
                      onDelete={() => void removeComment(r.id)}
                    />
                  )
                  // 每条 Bot 回复各一张卡片、**留在原位**。提到顶部会打乱时序 ——
                  // 文档侧为此翻过两次车,结论写在 botTask.ts 顶部。
                  return (
                    <li key={r.id}>
                      {botThread && isHtmlAgentReply(r) ? (
                        <AgentExecutionCard
                          task={{
                            state: botThread.replyState,
                            botUid: botThread.botUid,
                            reply: adaptHtmlComment(r),
                            rootCreatedAt: thread.created_at ?? '',
                          }}
                          names={names}
                        >
                          {body}
                        </AgentExecutionCard>
                      ) : (
                        body
                      )}
                    </li>
                  )
                })}
              </ul>
              {/* 串尾还在等 Bot 回话:单独一张卡片,不带 children(它自己渲染状态文案)。 */}
              {botThread?.pending ? (
                <AgentExecutionCard
                  task={{
                    state: botThread.pending,
                    botUid: botThread.botUid,
                    reply: null,
                    rootCreatedAt: thread.created_at ?? '',
                  }}
                  names={names}
                />
              ) : null}
              {/* Reply (commenter+): inline composer under the thread. reader never sees it. */}
              {mayComment && replyingToId === thread.id ? (
                <div className="octo-comment-compose">
                  <MentionComposer
                    key={`reply-${thread.id}-${replySeq}`}
                    docId={docId}
                    spaceId={space}
                    role={role}
                    placeholder={t('docs.comment.replyPlaceholder')}
                    onChange={setReplyDraft}
                    onSubmit={() => void submitReply(thread)}
                  />
                  <div className="octo-comment-compose-actions">
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
              ) : null}
              {/* 操作区:与文档/表格同一层同一个 class。表格那侧这里还有「解决」,
                  HTML 后端没有那个能力(PATCH /comments 只能改 anchor,改不了 status),
                  所以不放一个点了没反应的按钮。要补得先加后端接口。 */}
              <div className="octo-comment-actions">
                {mayComment && replyingToId !== thread.id && (
                  <button type="button" className="octo-tb-btn" onClick={() => startReply(thread.id)}>
                    {t('docs.comment.reply')}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {/* Composer (commenter+): reader is strictly read-only — the list above is enough, and the
          textarea / send / selection-target block is hidden entirely. */}
      {mayComment ? (
        <footer className="octo-drawer-comment-composer" aria-label={t('docs.comment.wholeDocLabel')}>
          {/* 有划词锚点时才叠加 octo-html-doc-comments-target —— 那个 class 带
              justify-content: space-between,是为了把「取消定位」按钮推到右端。
              全文档态下只有 📄 和「全文」两个 span,叠上去会把它们拆到两头(左一个右一个)。 */}
          <div
            className={`octo-drawer-comment-scope${pendingAnchor ? ' octo-html-doc-comments-target' : ''}`}
            data-testid="pending-anchor"
          >
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
              <>
                <span aria-hidden="true">📄</span>
                <span>{t('docs.comment.wholeDoc')}</span>
              </>
            )}
          </div>
          <div className="octo-drawer-comment-input-wrap">
            <MentionComposer
              key={composerSeq}
              docId={docId}
              spaceId={space}
              role={role}
              placeholder={t('docs.comment.placeholder')}
              onChange={setDraft}
              onSubmit={submit}
            />
          </div>
          <div className="octo-drawer-comment-actions">
            <span>{t('docs.comment.submitHint')}</span>
            <button
              type="button"
              className="octo-comment-submit"
              disabled={busy || draft.trim() === ''}
              onClick={submit}
            >
              {t('docs.comment.send')}
            </button>
          </div>
        </footer>
      ) : (
        <p className="octo-html-doc-comments-readonly" role="note">
          {t('docs.comment.readOnlyHint')}
        </p>
      )}
    </aside>
  )
}
