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
import type { Comment, CommentThread, CreateRootInput } from './api.ts'
import type { UseDocComments, CommentMutationResult } from './useDocComments.ts'
import { MentionComposer } from '../mentions/MentionComposer.tsx'
import { MentionText } from '../mentions/MentionText.tsx'
import { CollapsibleText } from './CollapsibleText.tsx'
import { CommentContextMenu, useCommentMenu } from './CommentContextMenu.tsx'
import { AgentExecutionCard } from './AgentExecutionCard.tsx'
import { deriveBotThread, isBotReply } from './botTask.ts'
import type { BotDiffHint } from '../versions/botEditForThread.ts'
import { AnchorRef } from './AnchorRef.tsx'
import { deriveAnchorState, isBotThread, isBotResolvedThread } from './threadMeta.ts'
import { useSpaceBotUids } from '../members/botUids.ts'
import { encodeAnchorRange } from './anchor.ts'

/** 折叠前保留的行数,取自原型的 `.comment-body .comment-text` / `.comment-replies .comment-text`。 */
const ROOT_TEXT_LINE_LIMIT = 5
const REPLY_TEXT_LINE_LIMIT = 3

/** 评论类型筛选(原型 `[data-comment-type-filter]`):全部 / 普通评论 / Bot 修改。 */
type CommentTypeFilter = 'all' | 'human' | 'bot'

const TYPE_FILTERS: readonly CommentTypeFilter[] = ['all', 'human', 'bot']

/**
 * 原型的「全部评论 ▾」下拉。
 *
 * 用 listbox 而不是 `<select>`:原型的选中态是一枚 ✓ 图标而非平台默认的高亮,`<select>`
 * 的选项渲染在浏览器的原生层里,拿不到样式。语义仍按 listbox 标注,键盘和读屏可用。
 */
function CommentTypeFilterMenu({
  value,
  onChange,
}: {
  value: CommentTypeFilter
  onChange: (v: CommentTypeFilter) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 点面板别处就收起。挂在 document 上而不是给遮罩层:评论区是抽屉里的一小块,加一层
  // 全屏遮罩会把它下面的正文点击也吃掉。
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="octo-comment-type-filter" ref={wrapRef}>
      <button
        type="button"
        className="octo-comment-filter-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{t(`docs.comment.filter.${value}`)}</span>
        <span className="octo-comment-filter-caret" aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && (
        <div className="octo-comment-type-menu" role="listbox" aria-label={t('docs.comment.filter.label')}>
          {TYPE_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="option"
              aria-selected={f === value}
              onClick={() => {
                onChange(f)
                setOpen(false)
              }}
            >
              <span>{t(`docs.comment.filter.${f}`)}</span>
              <span className="octo-menu-check" aria-hidden="true">
                ✓
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 原型的底部「全文评论」输入区(`.drawer-comment-composer`)。
 *
 * 后端契约冻结:根评论**必须**带 anchorStart/anchorEnd,没有「无锚点评论」这种东西。
 * 所以全文评论落成一个折叠在文首的锚点(from=to=1),anchorText 自然为空串 ——
 * 空 anchorText 就是「这条是全文评论」的判据(见 Thread 里 hasAnchor 的注释),
 * 没有新增任何线上字段。
 */
function WholeDocComposer({
  editor,
  role,
  docId,
  spaceId,
  onCreate,
}: {
  editor: Editor
  role: Role
  docId: string
  spaceId?: string
  onCreate: (input: CreateRootInput) => Promise<CommentMutationResult>
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (busy || body.trim() === '') return
    // 提交时重查一遍:输入框开着的时候被降权成 reader,不能靠开框那一刻的判断。
    if (!canComment(role)) return
    const enc = encodeAnchorRange(editor, 1, 1)
    if (!enc) {
      setError(t('docs.comment.errorAnchor'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await onCreate({
        body: body.trim(),
        anchorStart: enc.anchorStart,
        anchorEnd: enc.anchorEnd,
        anchorText: '',
      })
      if (result.ok) setBody('')
      else setError(result.error ?? t('docs.comment.errorAdd'))
    } catch {
      setError(t('docs.comment.errorAdd'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <footer className="octo-drawer-comment-composer" aria-label={t('docs.comment.wholeDocLabel')}>
      <div className="octo-drawer-comment-scope">
        <span aria-hidden="true">📄</span>
        <span>{t('docs.comment.wholeDoc')}</span>
      </div>
      <div className="octo-drawer-comment-input-wrap">
        <MentionComposer
          docId={docId}
          spaceId={spaceId}
          role={role}
          placeholder={t('docs.comment.wholeDocPlaceholder')}
          onChange={setBody}
          onSubmit={submit}
        />
      </div>
      {error && <p className="octo-member-error" role="alert">{error}</p>}
      <div className="octo-drawer-comment-actions">
        <span>{t('docs.comment.submitHint')}</span>
        <button
          type="button"
          className="octo-comment-submit"
          disabled={busy || body.trim() === ''}
          onClick={() => void submit()}
        >
          {t('docs.comment.commentButton')}
        </button>
      </div>
    </footer>
  )
}

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
  docId,
  spaceId,
  lineLimit,
}: {
  comment: Comment
  currentUid: string
  role: Role
  comments: UseDocComments
  names?: Map<string, string>
  /**
   * 折叠时保留的行数。原型对根评论截 5 行、对回复截 3 行 —— 回复更短更密,同样的额度
   * 会让一条长回复把整条串顶开。
   */
  lineLimit: number
  /** Doc being commented on — decides which Bots the @ menu may offer (Bot needs writer+ HERE). */
  docId: string
  spaceId?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const menu = useCommentMenu()
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const isAuthor = comment.authorUid === currentUid
  // Reader authors cannot delete. Authors at commenter+ soft-delete; admins hard-delete others.
  const softDelete = isAuthor && canComment(role)
  const hardDelete = !isAuthor && canManage(role)
  const canDelete = softDelete || hardDelete
  const canEditBody = isAuthor && canEdit(role)

  // Runtime downgrade fail-closed: if the role drops below edit while the composer is open, close it.
  useEffect(() => {
    if (editing && !canEditBody) setEditing(false)
  }, [editing, canEditBody])

  async function saveEdit() {
    if (busy) return
    // Re-check on submit so a stale closure (pre-downgrade) can't PATCH after writer->commenter/reader.
    if (!canEditBody) return
    if (draft.trim() === '') return
    setBusy(true)
    setMutationError(null)
    try {
      const result = await comments.editBody(comment.id, draft.trim())
      if (result.ok) setEditing(false)
      else setMutationError(result.error)
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    if (!canDelete) return
    if (!window.confirm(t('docs.comment.deleteConfirm'))) return
    setBusy(true)
    setMutationError(null)
    try {
      const result = await comments.remove(comment.id, hardDelete)
      if (!result.ok) setMutationError(result.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="octo-comment-body"
      tabIndex={0}
      {...menu.triggerProps}
    >
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
            docId={docId}
            spaceId={spaceId}
            role={role}
            autoFocus
            onChange={setDraft}
            onSubmit={saveEdit}
            onCancel={() => {
              setEditing(false)
              setDraft(comment.body)
            }}
          />
          {mutationError && <p className="octo-member-error" role="alert">{mutationError}</p>}
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
        <CollapsibleText lineLimit={lineLimit}>
          <MentionText body={comment.body} names={names} />
        </CollapsibleText>
      )}
      {!editing && mutationError && <p className="octo-member-error" role="alert">{mutationError}</p>}
      {/* 编辑 / 删除只在右键菜单里(底部只留「解决 / 回复」)。权限判定一字未改:
          Body edit 要 writer+(PATCH = author + writer),commenter 作者可以软删但不能编辑。 */}
      {!editing && (
        <CommentContextMenu
          anchor={menu.anchor}
          onClose={menu.close}
          items={[
            ...(canEditBody ? [{ key: 'edit', label: t('docs.comment.edit'), onSelect: () => setEditing(true) }] : []),
            ...(canDelete && !busy
              ? [{ key: 'delete', label: t('docs.comment.delete'), onSelect: onDelete, danger: true }]
              : []),
          ]}
        />
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
  docId,
  spaceId,
  botUids,
  onViewBotDiff,
}: {
  thread: CommentThread
  editor: Editor
  role: Role
  currentUid: string
  comments: UseDocComments
  active: boolean
  onSelect: () => void
  names?: Map<string, string>
  /** Doc being commented on — decides which Bots the @ menu may offer (Bot needs writer+ HERE). */
  docId: string
  spaceId?: string
  /**
   * Space 的 Bot uid 名册。空集合时每条串都读作人类评论 —— 紫色边框只在**确知**有 Bot
   * 参与时出现,认不出来就当人类,不靠猜。
   */
  botUids?: ReadonlySet<string>
  /** 跳到版本记录看这次 Bot 改动。可选:宿主没给就不渲染那个按钮(见 AgentExecutionCard)。 */
  onViewBotDiff?: (hint: BotDiffHint) => void
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [threadActionError, setThreadActionError] = useState<string | null>(null)
  const [replyError, setReplyError] = useState<string | null>(null)

  const ready = getYBinding(editor) != null
  const range = anchorRange(editor, thread)
  const ref = useRef<HTMLLIElement>(null)

  // 锚点状态交给 threadMeta 判定,不再自己算 orphaned。差别不只是搬家:
  // botApplied 必须压过「锚点解不出来」—— Bot 重写整段引用会同时废掉两个
  // RelativePosition,照旧逻辑会在 Bot 成功改完之后弹「原引用已失效」,把 Bot
  // 自己干的事算成用户的错。见 threadMeta.deriveAnchorState 的注释。
  //
  // hasAnchor 看 anchorText 而不是 anchorStart:「全文评论」是折叠在文首的锚点
  // (见下面 WholeDocComposer),anchorStart 非空但 anchorText 为空,拿它去和正文
  // 比会永远判成 changed,挂一个莫名的橙色「引用已变化」。
  const anchorState = deriveAnchorState({
    hasAnchor: Boolean(thread.anchorText),
    ready,
    liveText: range ? editor.state.doc.textBetween(range.from, range.to, ' ', ' ') : null,
    anchorText: thread.anchorText ?? '',
    botApplied: isBotResolvedThread(thread, botUids),
  })
  const isBot = isBotThread(thread, botUids)
  // 任务卡片只挂在「根评论 @ 了 Bot」的串上,并且状态复用上面已经算好的 anchorState ——
  // 「Bot 改完之后原文又变了」和「引用已变化」本来就是同一件事,分两处算必然会说法不一致。
  const botThread = deriveBotThread(thread, botUids, anchorState)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Runtime downgrade fail-closed: commenter->reader while a reply composer is open must close it.
  useEffect(() => {
    if (replyOpen && !canComment(role)) setReplyOpen(false)
  }, [replyOpen, role])

  function scrollToHighlight() {
    onSelect()
    if (!range) return
    editor.chain().setTextSelection(range).scrollIntoView().focus().run()
  }

  async function submitReply() {
    if (busy) return
    // Re-check on submit so a stale closure can't reply after commenter->reader.
    if (!canComment(role)) return
    if (replyBody.trim() === '') return
    setBusy(true)
    setReplyError(null)
    try {
      const result = await comments.reply(thread.id, replyBody.trim())
      if (result.ok) {
        setReplyBody('')
        setReplyOpen(false)
      } else setReplyError(result.error)
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
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      ref={ref}
      className={`octo-comment-thread${active ? ' is-selected' : ''}${isBot ? ' is-ai-edit' : ''}`}
      data-anchor-state={anchorState}
    >
      <AnchorRef
        anchorText={thread.anchorText ?? ''}
        anchorState={anchorState}
        resolved={thread.resolved}
        isBot={isBot}
        onActivate={scrollToHighlight}
      />

      <CommentBody comment={thread} currentUid={currentUid} role={role} comments={comments} names={names} docId={docId} spaceId={spaceId} lineLimit={ROOT_TEXT_LINE_LIMIT} />

      {/* 顶上不再挂卡片。新模型:卡片跟着**每条 Bot 回复**留在原位(见 botTask.ts),串尾还在
          等回话时再单独挂一张。整条串一张卡片必然要「提升」某条回复,而只要移动就会打乱问答
          时序 —— 前两版都栽在这上面。 */}
      {thread.replies.length > 0 && (
        <ul className="octo-comment-replies">
          {thread.replies.map((r) => {
            const body = (
              <CommentBody comment={r} currentUid={currentUid} role={role} comments={comments} names={names} docId={docId} spaceId={spaceId} lineLimit={REPLY_TEXT_LINE_LIMIT} />
            )
            // Bot 自己的回复套一张卡片,**留在原位**;其余(人类追问、别的 Bot)原样渲染。
            return (
              <li key={r.id}>
                {botThread && isBotReply(r, botThread.botUid) ? (
                  <AgentExecutionCard
                    task={{ state: botThread.replyState, botUid: botThread.botUid, reply: r, rootCreatedAt: thread.createdAt }}
                    names={names}
                    {...(onViewBotDiff ? { onViewBotDiff } : {})}
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
      )}

      {/* 串尾还在等这个 Bot 回话 —— 卡片挂在**最后**,因为它说的是「最后这句请求还没被答复」,
          挂顶上会让人以为整条串都没动过(顶上那条早就答完了)。 */}
      {botThread?.pending && (
        <AgentExecutionCard
          task={{ state: botThread.pending, botUid: botThread.botUid, reply: null, rootCreatedAt: thread.createdAt }}
          names={names}
        />
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
        {canComment(role) && !replyOpen && (
          <button type="button" className="octo-tb-btn" onClick={() => setReplyOpen(true)}>
            {t('docs.comment.reply')}
          </button>
        )}
      </div>
      {threadActionError && <p className="octo-member-error" role="alert">{threadActionError}</p>}

      {replyOpen && (
        <div className="octo-comment-compose">
          <MentionComposer
            docId={docId}
            spaceId={spaceId}
            role={role}
            placeholder={t('docs.comment.replyPlaceholder')}
            autoFocus
            onChange={setReplyBody}
            onSubmit={submitReply}
            onCancel={() => {
              setReplyOpen(false)
              setReplyBody('')
            }}
          />
          {replyError && <p className="octo-member-error" role="alert">{replyError}</p>}
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
  docId,
  spaceId,
  onClose,
  onViewBotDiff,
}: {
  role: Role
  editor: Editor
  comments: UseDocComments
  activeCommentId: number | null
  onSelectComment: (id: number | null) => void
  names?: Map<string, string>
  /**
   * The document being commented on. Decides which Bots may be @-mentioned in the edit/reply
   * composers (a Bot is only offerable when it holds writer+ on THIS doc), so without it no Bot is
   * offered at all. Required — the shell always has it, and a missed call site should not go silent.
   */
  docId: string
  spaceId?: string
  onClose?: () => void
  /** 见 Thread 的同名 prop。CommentPanel 只负责往下透传。 */
  onViewBotDiff?: (hint: BotDiffHint) => void
}) {
  useEditorTick(editor)
  const currentUid = getCurrentUid()
  const { threads, loading, error, nextCursor, includeResolved, setIncludeResolved, loadMore } =
    comments
  const botUids = useSpaceBotUids(spaceId ?? '')
  const [typeFilter, setTypeFilter] = useState<CommentTypeFilter>('all')

  // 筛选在前端做,不发新请求:类型是 UI 侧的推导(isBotThread 靠 uid 名册判断),后端
  // 没有「是不是 Bot」这一列,拿它去当查询参数就是凭空发明线上字段。
  // includeResolved 相反 —— 那是真的查询参数,所以仍走 setIncludeResolved。
  const visible =
    typeFilter === 'all'
      ? threads
      : threads.filter((th) => isBotThread(th, botUids) === (typeFilter === 'bot'))

  return (
    <section className="octo-comment-panel">
      <header className="octo-drawer-header octo-comment-drawer-header">
        <h2>{t('docs.comment.title')}</h2>
        {onClose && (
          <button type="button" className="octo-drawer-close" onClick={onClose}>
            {t('docs.comment.close')}
          </button>
        )}
      </header>

      <div className="octo-comment-panel-content">
        <div className="octo-comment-filter-row">
          <CommentTypeFilterMenu value={typeFilter} onChange={setTypeFilter} />
          <label className="octo-show-resolved-filter">
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(e) => setIncludeResolved(e.target.checked)}
            />
            <span>{t('docs.comment.showResolved')}</span>
          </label>
        </div>

        {error && <p className="octo-member-error">{error}</p>}
        {loading && threads.length === 0 && (
          <p className="octo-loading">{t('docs.comment.loading')}</p>
        )}
        {/* 空态文案分两种:一条评论都没有 vs 有评论但被筛掉了。后者说「暂无记录」还让
            用户以为评论丢了 —— 原型的 `.comment-empty` 就是写「当前筛选下暂无记录」。 */}
        {!loading && visible.length === 0 && (
          <p className="octo-comment-empty">
            {threads.length === 0 ? t('docs.comment.empty') : t('docs.comment.emptyFiltered')}
          </p>
        )}

        <ul className="octo-comment-list">
          {visible.map((th) => (
            <Thread
              key={th.id}
              thread={th}
              editor={editor}
              role={role}
              currentUid={currentUid}
              comments={comments}
              names={names}
              docId={docId}
              spaceId={spaceId}
              botUids={botUids}
              {...(onViewBotDiff ? { onViewBotDiff } : {})}
              active={activeCommentId === th.id}
              onSelect={() => onSelectComment(th.id)}
            />
          ))}
        </ul>

        {nextCursor != null && (
          <button
            type="button"
            className="octo-tb-btn"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {t('docs.comment.loadMore')}
          </button>
        )}
      </div>

      {/* 只有能评论的角色才看到输入框。reader 看到一个提交必然失败的框比看不到更糟。 */}
      {canComment(role) && (
        <WholeDocComposer
          editor={editor}
          role={role}
          docId={docId}
          spaceId={spaceId}
          onCreate={comments.createRoot}
        />
      )}
    </section>
  )
}
