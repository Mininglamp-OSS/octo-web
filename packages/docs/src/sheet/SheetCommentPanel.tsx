// Cell-anchored comment panel for spreadsheets — the sheet counterpart of the docs
// CommentPanel. It reuses the docs comment REST layer wholesale via useDocComments
// (create / reply / edit / resolve / delete + pagination), and the same octo-comment-*
// CSS + t() labels, so it behaves and looks like the document comments. The ONLY
// sheet-specific part is anchoring: a document comment anchors to a ProseMirror text
// range (a Yjs RelativePosition), whereas a sheet comment anchors to a cell — we store
// the cell key (base64) in anchorStart/anchorEnd and the A1 label in anchorText.
//
// Navigation, both ways:
//   - click a thread's cell chip  -> select + scroll to that cell (sheet.focusCell)
//   - select a commented cell     -> highlight its thread here (sheet.onActiveCell)
// and every commented cell gets a corner badge in the grid (sheet.setCommentedCells).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { canComment, canEdit, canManage } from '../auth/roles.ts'
import { getCurrentUid, t } from '../octoweb/index.ts'
import { formatRelative, formatAbsolute } from '../versions/format.ts'
import type { CommentMutationResult, UseDocComments } from '../comments/useDocComments.ts'
import type { Comment, CommentThread, CreateRootInput } from '../comments/api.ts'
import type { CollabSheet } from './CollabSheet.ts'
import { MentionComposer } from '../mentions/MentionComposer.tsx'
import { MentionText } from '../mentions/MentionText.tsx'
import { CollapsibleText } from '../comments/CollapsibleText.tsx'
import { CommentContextMenu, useCommentMenu } from '../comments/CommentContextMenu.tsx'
import { AgentExecutionCard } from '../comments/AgentExecutionCard.tsx'
import { deriveBotThread, isBotReply } from '../comments/botTask.ts'
import type { BotDiffHint } from '../versions/botEditForThread.ts'
import { useSpaceBotUids } from '../members/botUids.ts'

/**
 * Legacy V1 single-sheet docs anchored comments to the raw Univer sheet id (`octo-sheet-1`,
 * from `getSheetId()`) — see the #537 CollabSheet.getActiveCellRef. V2 anchors to the STABLE
 * logical id, whose single-sheet value is 'default'. Normalize the legacy id to 'default' on
 * decode so old comments still resolve to their cell (P1-2): without this every pre-V2 comment
 * loses its badge, cell highlight, and click-to-focus because 'octo-sheet-1' !== 'default' in
 * cellMatches / marker filtering. V2 never anchors to 'octo-sheet-1' (the default sheet's local
 * id maps to logical 'default'; extra sheets use their own univer ids), so this rewrite is safe.
 */
const LEGACY_V1_SHEET_ID = 'octo-sheet-1'
const DEFAULT_LOGICAL_SHEET_ID = 'default'

/** Decode a sheet comment anchor (base64 of `${sheetId}!${row}:${col}`) back to row/col + logical sheet id.
 * Exported for unit tests that lock the legacy-anchor normalization contract (P1-2). */
export function parseCell(anchorStart?: string | null): { row: number; col: number; sheetId: string } | null {
  if (!anchorStart) return null
  try {
    const parts = atob(anchorStart).split('!')
    const rc = parts[1]
    if (!rc) return null
    const rawSheetId = parts[0]
    const sheetId = rawSheetId === LEGACY_V1_SHEET_ID ? DEFAULT_LOGICAL_SHEET_ID : rawSheetId
    const [rs, cs] = rc.split(':')
    const row = Number(rs)
    const col = Number(cs)
    if (Number.isInteger(row) && Number.isInteger(col)) return { row, col, sheetId }
  } catch {
    // not a cell anchor (e.g. a legacy/doc anchor) — treat as unanchored
  }
  return null
}

/**
 * 「全表评论」的锚点载荷。
 *
 * 后端要求根评论必须带 anchorStart/anchorEnd 且是合法 base64(文档里那两个字段放的是 Yjs
 * RelativePosition)。全表评论不指向任何单元格,所以塞一个哨兵字符串再 base64。
 *
 * 关键:哨兵**不能含 `!`** —— parseCell 用 `!` 拆 sheetId 和 row:col,含 `!` 的值会被解析成
 * 某个具体单元格,于是全表评论会在一个随机格子上画出标记。没有 `!` 时 parseCell 返回 null
 * (走「未锚定」分支),这正是我们要的。
 */
export const WHOLE_SHEET_ANCHOR_KEY = 'whole-sheet'

/**
 * 这条串是不是「全表评论」。
 *
 * 判据是 **anchorText 为空**,与文档侧一致(见 CommentPanel 的 WholeDocComposer:空 anchorText
 * 就是「这是全文评论」的判据)。不拿 anchorStart 去比哨兵值:历史数据里可能有别的未锚定形态,
 * 用「有没有单元格地址」判断更稳,也不会因为哨兵值以后改动而失效。
 */
export function isWholeSheetThread(thread: { anchorText?: string | null }): boolean {
  return !thread.anchorText || thread.anchorText.trim() === ''
}

/** A cell coordinate carrying its logical sheet id. */
export type SheetCell = { row: number; col: number; sheetId: string }

/**
 * Sheet-scoped cell equality for active-thread highlighting. Row/col alone is NOT enough:
 * a thread anchored to (5,3) on Sheet B must not be selected when you pick (5,3) on Sheet A.
 * All match sites now carry the logical sheet id, so compare it too. Exported for unit tests
 * that lock the cross-sheet selection contract.
 */
export function cellMatches(cell: SheetCell, target: SheetCell): boolean {
  return cell.row === target.row && cell.col === target.col && cell.sheetId === target.sheetId
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
  /** Doc being commented on — decides which Bots the @ menu may offer (Bot needs writer+ HERE). */
  docId: string
  spaceId?: string
  /** 折叠前保留的行数。与文档面板同一套额度:根评论 5、回复 3。 */
  lineLimit: number
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

  // Runtime downgrade fail-closed: close the edit composer if the role drops below edit.
  useEffect(() => {
    if (editing && !canEditBody) setEditing(false)
  }, [editing, canEditBody])

  async function saveEdit() {
    if (busy) return
    // Re-check on submit so a stale closure can't PATCH after writer->commenter/reader.
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
            <button type="button" className="octo-tb-btn" disabled={busy || draft.trim() === ''} onClick={saveEdit}>
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
  role,
  currentUid,
  comments,
  active,
  onSelect,
  onJump,
  names,
  docId,
  spaceId,
  botUids,
  onViewBotDiff,
}: {
  thread: CommentThread
  role: Role
  currentUid: string
  comments: UseDocComments
  active: boolean
  onSelect: () => void
  onJump: () => void
  names?: Map<string, string>
  /** Doc being commented on — decides which Bots the @ menu may offer (Bot needs writer+ HERE). */
  docId: string
  spaceId?: string
  /** Space 的 Bot uid 名册。空集合时每条串都读作人类评论(fail closed,见 botTask.ts)。 */
  botUids?: ReadonlySet<string>
  /** 跳到版本记录看这次 Bot 改动。可选:没给就不渲染那个按钮。 */
  onViewBotDiff?: (hint: BotDiffHint) => void
}) {
  // 表格的锚点是单元格地址,不是 Yjs 相对位置,所以没有「引用的原文变了」这个概念 ——
  // 恒传 'active',而不是去猜一个 stale 状态。
  const botThread = deriveBotThread(thread, botUids, 'active')
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [threadActionError, setThreadActionError] = useState<string | null>(null)
  const [replyError, setReplyError] = useState<string | null>(null)
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  // Runtime downgrade fail-closed: commenter->reader while a reply composer is open must close it.
  useEffect(() => {
    if (replyOpen && !canComment(role)) setReplyOpen(false)
  }, [replyOpen, role])

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
    <li ref={ref} className={`octo-comment-thread${active ? ' is-selected' : ''}`}>
      <button
        type="button"
        className="octo-comment-anchor"
        onClick={() => {
          onSelect()
          onJump()
        }}
      >
        {/* 空 anchorText = 全表评论,chip 必须说「全文」。退回「单元格」是错的:它压根不指向
            任何单元格,点它也跳不过去。 */}
        <span className="octo-comment-quote">
          {isWholeSheetThread(thread) ? t('docs.comment.wholeDoc') : thread.anchorText}
        </span>
        {thread.resolved && <span className="octo-comment-resolved-badge">{t('docs.comment.resolvedBadge')}</span>}
      </button>

      <CommentBody comment={thread} currentUid={currentUid} role={role} comments={comments} names={names} docId={docId} spaceId={spaceId} lineLimit={5} />

      {/* 顶上不再挂卡片。新模型:卡片跟着**每条 Bot 回复**留在原位(见 botTask.ts),串尾还在
          等回话时再单独挂一张。整条串一张卡片必然要「提升」某条回复,而只要移动就会打乱问答
          时序 —— 前两版都栽在这上面。 */}
      {thread.replies.length > 0 && (
        <ul className="octo-comment-replies">
          {thread.replies.map((r) => {
            const body = (
              <CommentBody comment={r} currentUid={currentUid} role={role} comments={comments} names={names} docId={docId} spaceId={spaceId} lineLimit={3} />
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
            <button type="button" className="octo-tb-btn" disabled={busy || replyBody.trim() === ''} onClick={submitReply}>
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

/**
 * 「全表评论」输入框(对齐文档侧的 WholeDocComposer)。
 *
 * 表格原来只能对**选中的单元格**评论:没选格子就报「请先选择单元格」。于是「这张表整体
 * 有个问题」或者「@Bot 帮我把整张表怎样」压根没有入口 —— 文档侧早就有了(底部那条
 * 「📄 全文」),表格缺一块。
 *
 * 锚点用哨兵值(见 WHOLE_SHEET_ANCHOR_KEY),anchorText 传空串 —— 空 anchorText 就是
 * 「全文评论」的判据,和文档侧同一套。
 */
function WholeSheetComposer({
  role,
  docId,
  spaceId,
  onCreate,
}: {
  role: Role
  docId: string
  spaceId?: string
  onCreate: (input: CreateRootInput) => Promise<CommentMutationResult>
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seq, setSeq] = useState(0)

  async function submit() {
    if (busy || body.trim() === '') return
    // 提交时重查一遍:输入框开着的时候被降权成 reader,不能靠开框那一刻的判断。
    if (!canComment(role)) return
    setBusy(true)
    setError(null)
    try {
      const encoded = btoa(WHOLE_SHEET_ANCHOR_KEY)
      const result = await onCreate({
        body: body.trim(),
        anchorStart: encoded,
        anchorEnd: encoded,
        anchorText: '',
      })
      if (result.ok) {
        setBody('')
        // MentionComposer 是非受控的(只读一次 initialBody),换 key 才能真正清空。
        setSeq((n) => n + 1)
      } else {
        setError(result.error ?? t('docs.comment.errorAdd'))
      }
    } catch {
      setError(t('docs.comment.errorAdd'))
    } finally {
      setBusy(false)
    }
  }

  if (!canComment(role)) return null

  return (
    <footer className="octo-drawer-comment-composer" aria-label={t('docs.comment.wholeDocLabel')}>
      <div className="octo-drawer-comment-scope">
        <span aria-hidden="true">📄</span>
        <span>{t('docs.comment.wholeDoc')}</span>
      </div>
      <div className="octo-drawer-comment-input-wrap">
        <MentionComposer
          key={seq}
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

export function SheetCommentPanel({
  sheet,
  role,
  names,
  comments,
  focusCell,
  docId,
  spaceId,
  onClose,
  onViewBotDiff,
}: {
  /**
   * The sheet document being commented on. Decides which Bots may be @-mentioned in the compose /
   * reply / edit composers (a Bot is only offerable when it holds writer+ on THIS doc), so without
   * it no Bot is offered at all.
   */
  docId: string
  sheet: CollabSheet | null
  role: Role
  names?: Map<string, string>
  comments: UseDocComments
  /** When set (e.g. from a marker click), select the thread anchored to this cell. */
  focusCell?: { row: number; col: number; sheetId: string } | null
  spaceId?: string
  onClose?: () => void
  /** 见 Thread 的同名 prop。面板只负责往下透传。 */
  onViewBotDiff?: (hint: BotDiffHint) => void
}) {
  const currentUid = getCurrentUid()
  const botUids = useSpaceBotUids(spaceId ?? '')
  const { threads, loading, error, nextCursor, includeResolved, setIncludeResolved, loadMore, createRoot } = comments

  const [body, setBody] = useState('')
  // Two-step entry (XIN-1337): the composer is hidden behind an always-clickable button so it never
  // reads as a permanently-disabled control. Revealing it mounts a fresh MentionComposer.
  const [composing, setComposing] = useState(false)
  // Bumped after a successful post to remount MentionComposer (it is uncontrolled — reads initialBody
  // once, so setBody('') alone would leave stale text). Changing its `key` forces a fresh empty editor.
  const [composeSeq, setComposeSeq] = useState(0)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null)
  const [composeError, setComposeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Runtime downgrade fail-closed: commenter->reader while composing a new comment must close it.
  useEffect(() => {
    if (composing && !canComment(role)) setComposing(false)
  }, [composing, role])

  // Map every thread to its cell (for selection matching), keyed by thread id.
  const cellByThread = useMemo(() => {
    const m = new Map<number, { row: number; col: number; sheetId: string }>()
    for (const th of threads) {
      const cell = parseCell(th.anchorStart)
      if (cell) m.set(th.id, cell)
    }
    return m
  }, [threads])

  // When the user selects a cell, highlight the thread anchored to it (if any).
  useEffect(() => {
    if (!sheet) return
    // Seed from the CURRENT selection so the compose label reads "评论 A1" the moment the
    // panel mounts (or the sheet changes), instead of falling back to "评论当前单元格" until
    // the next selection change fires. Without this, opening the panel with a cell already
    // selected shows the generic label even though a concrete cell is targeted.
    setActiveCellKey(sheet.getActiveCellRef()?.a1 ?? null)
    return sheet.onActiveCell((r) => {
      setActiveCellKey(r?.a1 ?? null)
      if (!r) return
      const rc = parseCell(btoa(r.key))
      if (!rc) return
      for (const [id, cell] of cellByThread) {
        // Match the logical sheet id too — a thread anchored to (5,3) on Sheet B must not
        // highlight when you select (5,3) on Sheet A. Both sides carry sheetId (key = `${sheetId}!row:col`).
        if (cellMatches(cell, rc)) {
          setActiveId(id)
          return
        }
      }
    })
  }, [sheet, cellByThread])

  // A marker click (or any external focus request) selects that cell's thread.
  useEffect(() => {
    if (!focusCell) return
    for (const [id, cell] of cellByThread) {
      // Sheet-scoped match: a marker click on Sheet A must not select Sheet B's thread at the same row/col.
      if (cellMatches(cell, focusCell)) {
        setActiveId(id)
        return
      }
    }
  }, [focusCell, cellByThread])

  const submit = async () => {
    if (busy) return
    // Re-check on submit so a stale closure can't create after commenter->reader.
    if (!canComment(role)) return
    const ref = sheet?.getActiveCellRef()
    if (!ref) {
      setComposeError(t('docs.sheet.comment.selectFirst'))
      return
    }
    if (!body.trim()) return
    setBusy(true)
    try {
      // The backend validates anchorStart/anchorEnd as strict base64 (they hold a Yjs
      // RelativePosition for docs). We base64-encode the cell key so it passes that check;
      // the human-readable A1 label rides in anchorText and is shown as the thread chip.
      const encoded = btoa(ref.key)
      const result = await createRoot({ body: body.trim(), anchorStart: encoded, anchorEnd: encoded, anchorText: ref.a1 })
      if (!result.ok) {
        setComposeError(result.error)
        return
      }
      setBody('')
      setComposeSeq((n) => n + 1)
      setComposeError(null)
      // Collapse back to the always-visible entry button (two-step interaction, mirrors the
      // doc CommentBubble). Keeping the composer open would re-disable the submit button on the
      // now-empty body — exactly the "looks permanently disabled" confusion we're fixing.
      setComposing(false)
    } catch {
      setComposeError(t('docs.sheet.comment.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="octo-comment-panel octo-comment-panel--sheet">
      <div className="octo-member-row">
        <h3 style={{ flex: 1, margin: 0 }}>{t('docs.comment.title')}</h3>
        <label className="octo-comment-toggle">
          <input type="checkbox" checked={includeResolved} onChange={(e) => setIncludeResolved(e.target.checked)} />
          {t('docs.comment.showResolved')}
        </label>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            {t('docs.comment.close')}
          </button>
        )}
      </div>

      {canComment(role) && (
        <div className="octo-comment-compose">
          {composing ? (
            <>
              <MentionComposer
                key={composeSeq}
                docId={docId}
                spaceId={spaceId}
                role={role}
                autoFocus
                placeholder={t('docs.sheet.comment.placeholder')}
                onChange={setBody}
                onSubmit={() => void submit()}
              />
              <div className="octo-comment-compose-actions">
                <button type="button" className="octo-tb-btn" disabled={busy || !body.trim()} onClick={() => void submit()}>
                  {activeCellKey ? `${t('docs.sheet.comment.menu')} ${activeCellKey}` : t('docs.sheet.comment.current')}
                </button>
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy}
                  onClick={() => {
                    setComposing(false)
                    setBody('')
                    setComposeError(null)
                  }}
                >
                  {t('docs.comment.cancel')}
                </button>
              </div>
              {composeError && (
                <p className="octo-member-error" role="alert">
                  {composeError}
                </p>
              )}
            </>
          ) : (
            // Always-visible, always-clickable entry affordance (disabled only while the sheet
            // is not yet connected). Clicking it reveals the MentionComposer and focuses the input —
            // the two-step interaction the doc CommentBubble already uses. This replaces the
            // old layout where the compose box + a `!body.trim()`-locked submit button showed
            // up-front, which read as a permanently-disabled control (XIN-1337).
            <button
              type="button"
              className="octo-tb-btn"
              disabled={!sheet}
              onClick={() => {
                setComposeError(null)
                setComposing(true)
              }}
            >
              💬 {t('docs.comment.commentButton')}
            </button>
          )}
        </div>
      )}

      {error && <p className="octo-member-error">{error}</p>}
      {loading && threads.length === 0 && <p className="octo-loading">{t('docs.comment.loading')}</p>}
      {!loading && threads.length === 0 && <p className="octo-comment-empty">{t('docs.comment.empty')}</p>}

      <ul className="octo-comment-list">
        {threads.map((th) => (
          <Thread
            key={th.id}
            thread={th}
            role={role}
            currentUid={currentUid}
            comments={comments}
            names={names}
            docId={docId}
            spaceId={spaceId}
            botUids={botUids}
            {...(onViewBotDiff ? { onViewBotDiff } : {})}
            active={activeId === th.id}
            onSelect={() => setActiveId(th.id)}
            onJump={() => {
              const cell = cellByThread.get(th.id)
              if (cell) sheet?.focusCell(cell.row, cell.col, cell.sheetId)
            }}
          />
        ))}
      </ul>

      {nextCursor != null && (
        <button type="button" className="octo-tb-btn" disabled={loading} onClick={() => void loadMore()}>
          {t('docs.comment.loadMore')}
        </button>
      )}

      {/* 全表评论固定在最底部,和文档侧同一个位置 —— 它不依赖选区,所以不该藏在
          「先选个单元格」后面。 */}
      <WholeSheetComposer role={role} docId={docId} spaceId={spaceId} onCreate={createRoot} />
    </section>
  )
}
