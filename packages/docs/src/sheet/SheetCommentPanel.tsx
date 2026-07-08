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
import type { UseDocComments } from '../comments/useDocComments.ts'
import type { Comment, CommentThread } from '../comments/api.ts'
import type { CollabSheet } from './CollabSheet.ts'

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
}: {
  comment: Comment
  currentUid: string
  role: Role
  comments: UseDocComments
  names?: Map<string, string>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [busy, setBusy] = useState(false)

  const isAuthor = comment.authorUid === currentUid
  const canHardDelete = !isAuthor && canManage(role)

  async function saveEdit() {
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
          <textarea
            className="octo-comment-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
          />
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
        <p className="octo-comment-text">{comment.body}</p>
      )}
      {!editing && (isAuthor || canHardDelete) && (
        <div className="octo-comment-actions">
          {isAuthor && (
            <button type="button" className="octo-tb-btn" onClick={() => setEditing(true)}>
              {t('docs.comment.edit')}
            </button>
          )}
          <button type="button" className="octo-tb-btn" disabled={busy} onClick={onDelete}>
            {t('docs.comment.delete')}
          </button>
        </div>
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
}: {
  thread: CommentThread
  role: Role
  currentUid: string
  comments: UseDocComments
  active: boolean
  onSelect: () => void
  onJump: () => void
  names?: Map<string, string>
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  async function submitReply() {
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
      <button
        type="button"
        className="octo-comment-anchor"
        onClick={() => {
          onSelect()
          onJump()
        }}
      >
        <span className="octo-comment-quote">{thread.anchorText || t('docs.sheet.comment.cellChip')}</span>
        {thread.resolved && <span className="octo-comment-resolved-badge">{t('docs.comment.resolvedBadge')}</span>}
      </button>

      <CommentBody comment={thread} currentUid={currentUid} role={role} comments={comments} names={names} />

      {thread.replies.length > 0 && (
        <ul className="octo-comment-replies">
          {thread.replies.map((r) => (
            <li key={r.id}>
              <CommentBody comment={r} currentUid={currentUid} role={role} comments={comments} names={names} />
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
          <textarea
            className="octo-comment-input"
            placeholder={t('docs.comment.replyPlaceholder')}
            value={replyBody}
            autoFocus
            onChange={(e) => setReplyBody(e.target.value)}
          />
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

export function SheetCommentPanel({
  sheet,
  role,
  names,
  comments,
  focusCell,
  onClose,
}: {
  docId: string
  sheet: CollabSheet | null
  role: Role
  names?: Map<string, string>
  comments: UseDocComments
  /** When set (e.g. from a marker click), select the thread anchored to this cell. */
  focusCell?: { row: number; col: number; sheetId: string } | null
  onClose?: () => void
}) {
  const currentUid = getCurrentUid()
  const { threads, loading, error, nextCursor, includeResolved, setIncludeResolved, loadMore, createRoot } = comments

  const [body, setBody] = useState('')
  const [activeId, setActiveId] = useState<number | null>(null)
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null)
  const [composeError, setComposeError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      await createRoot({ body: body.trim(), anchorStart: encoded, anchorEnd: encoded, anchorText: ref.a1 })
      setBody('')
      setComposeError(null)
    } catch {
      setComposeError(t('docs.sheet.comment.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="octo-comment-panel">
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
          <textarea
            className="octo-comment-input"
            placeholder={t('docs.sheet.comment.placeholder')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
          />
          <div className="octo-comment-compose-actions">
            <button type="button" className="octo-tb-btn" disabled={busy || !body.trim()} onClick={() => void submit()}>
              {activeCellKey ? `${t('docs.sheet.comment.menu')} ${activeCellKey}` : t('docs.sheet.comment.current')}
            </button>
          </div>
          {composeError && (
            <p className="octo-member-error" role="alert">
              {composeError}
            </p>
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
    </section>
  )
}
