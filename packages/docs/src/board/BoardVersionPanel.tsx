// Version-history panel for whiteboards — the board counterpart of SheetVersionPanel / the docs
// VersionPanel. It REUSES the shared version REST layer (versions/api.ts) for list / create /
// rename / delete UNCHANGED; the only board-specific parts live in boardVersions.ts and here:
//   - preview decodes the version's Excalidraw SCENE and renders a read-only canvas
//     (BoardScenePreview) instead of a Tiptap document or a sheet grid.
//   - restore surfaces the wider board failure set (403 access-revoked/epoch, 409 conflict,
//     413 too-large, 404 gone, 409 schema) with a distinct message per case (versionErrorKey).
//   - restore is non-destructive: the backend auto-snapshots current state then reconciles the
//     board in place, and the live canvas updates via normal Yjs sync — no client-side mutation.
//
// It touches no doc/sheet file, so it won't conflict with ongoing docs work.

import { useCallback, useEffect, useState } from 'react'
import type { Role } from '../auth/roles.ts'
import { canEdit, canManage } from '../auth/roles.ts'
import { t } from '../octoweb/index.ts'
import { formatRelative, formatAbsolute } from '../versions/format.ts'
import {
  listVersions,
  createNamedVersion,
  restoreVersion,
  renameVersion,
  deleteVersion,
  type VersionMeta,
  type VersionCounts,
} from '../versions/api.ts'
import { getBoardVersionState, versionErrorKey, type BoardVersionScene } from './boardVersions.ts'
import { BoardScenePreview } from './BoardScenePreview.tsx'

type KindFilter = 'all' | 'manual' | 'auto'
const PAGE = 30

export function BoardVersionPanel({
  docId,
  role,
  dark,
  names,
  onClose,
  onRestored,
}: {
  docId: string
  role: Role
  dark?: boolean
  names?: Map<string, string>
  onClose?: () => void
  /** Called after a successful restore (the live board reconciles via Yjs; hosts may refresh chrome). */
  onRestored?: () => void
}) {
  const [items, setItems] = useState<VersionMeta[]>([])
  const [counts, setCounts] = useState<VersionCounts | null>(null)
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [kind, setKind] = useState<KindFilter>('all')
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Inline "save current version" compose row (mirror of the sheet/docs panels): a collapsed button
  // expands to a name input + save/cancel, instead of a native window.prompt.
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [snapshotLabel, setSnapshotLabel] = useState('')

  const [preview, setPreview] = useState<{ seq: number; scene: BoardVersionScene } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const nameOf = (uid: string) => names?.get(uid) || uid

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listVersions(docId, { kind, limit: PAGE })
      setItems(res.items)
      setNextCursor(res.nextCursor)
      setCounts(res.counts ?? null)
    } catch {
      setError(t('docs.board.version.errLoad'))
    } finally {
      setLoading(false)
    }
  }, [docId, kind])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const onLoadMore = async () => {
    if (loadingMore || nextCursor == null) return
    setLoadingMore(true)
    setError(null)
    try {
      const res = await listVersions(docId, { kind, cursor: nextCursor, limit: PAGE })
      setItems((cur) => [...cur, ...res.items])
      setNextCursor(res.nextCursor)
      if (res.counts) setCounts(res.counts)
    } catch {
      setError(t('docs.board.version.errLoad'))
    } finally {
      setLoadingMore(false)
    }
  }

  const onCreateSnapshot = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await createNamedVersion(docId, snapshotLabel.trim() || undefined)
      setSnapshotOpen(false)
      setSnapshotLabel('')
      await refresh()
    } catch {
      setError(t('docs.board.version.errSave'))
    } finally {
      setBusy(false)
    }
  }

  const onPreview = async (seq: number) => {
    setPreviewLoading(true)
    setError(null)
    try {
      const state = await getBoardVersionState(docId, seq)
      setPreview({ seq, scene: state.scene })
    } catch (e) {
      setError(t(versionErrorKey(e, 'docs.board.version.errPreview')))
    } finally {
      setPreviewLoading(false)
    }
  }

  const onRestore = async (seq: number) => {
    if (!window.confirm(t('docs.board.version.restoreConfirm'))) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await restoreVersion(docId, seq)
      setPreview(null)
      setNotice(t('docs.board.version.restoredNotice'))
      await refresh()
      onRestored?.()
    } catch (e) {
      setError(t(versionErrorKey(e, 'docs.board.version.errRestore')))
    } finally {
      setBusy(false)
    }
  }

  const onRename = async (seq: number, cur: string) => {
    const label = window.prompt(t('docs.board.version.renamePrompt'), cur)
    if (label === null || label.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await renameVersion(docId, seq, label.trim())
      await refresh()
    } catch {
      setError(t('docs.board.version.errRename'))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (seq: number) => {
    if (!window.confirm(t('docs.board.version.deleteConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      await deleteVersion(docId, seq)
      if (preview?.seq === seq) setPreview(null)
      await refresh()
    } catch (e) {
      setError(t(versionErrorKey(e, 'docs.board.version.errDelete')))
    } finally {
      setBusy(false)
    }
  }

  const kindLabel = (k: VersionMeta['kind']) =>
    k === 'named'
      ? t('docs.board.version.kindNamed')
      : k === 'restore-marker'
        ? t('docs.board.version.kindRestore')
        : t('docs.board.version.kindAuto')

  const filterBtn = (k: KindFilter, label: string) => (
    <button
      type="button"
      className={kind === k ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
      aria-pressed={kind === k}
      disabled={loading}
      onClick={() => setKind(k)}
    >
      {label}
    </button>
  )

  return (
    <section className="octo-comment-panel octo-board-version-panel">
      <div className="octo-member-row">
        <h3 style={{ flex: 1, margin: 0 }}>{t('docs.board.version.title')}</h3>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            {t('docs.board.version.close')}
          </button>
        )}
      </div>

      <div className="octo-member-row octo-board-version-filters">
        {filterBtn('all', t('docs.board.version.filterAll'))}
        {filterBtn('manual', t('docs.board.version.filterManual'))}
        {filterBtn('auto', t('docs.board.version.filterAuto'))}
        {counts && (
          <span className="octo-board-version-counts" style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>
            {t('docs.board.version.countManual')} {counts.manual + counts.restore} · {t('docs.board.version.countAuto')} {counts.auto}
          </span>
        )}
      </div>

      {/* Save current version — inline compose row (writer+). */}
      {canEdit(role) && (
        <div className="octo-version-save">
          {snapshotOpen ? (
            <div className="octo-member-row">
              <input
                className="octo-uid"
                placeholder={t('docs.board.version.labelPlaceholder')}
                value={snapshotLabel}
                onChange={(e) => setSnapshotLabel(e.target.value)}
                autoFocus
              />
              <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => void onCreateSnapshot()}>
                {t('docs.board.version.saveAction')}
              </button>
              <button
                type="button"
                className="octo-tb-btn"
                disabled={busy}
                onClick={() => {
                  setSnapshotOpen(false)
                  setSnapshotLabel('')
                }}
              >
                {t('docs.board.version.cancel')}
              </button>
            </div>
          ) : (
            <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => setSnapshotOpen(true)}>
              {t('docs.board.version.save')}
            </button>
          )}
        </div>
      )}

      {error && <p className="octo-member-error">{error}</p>}
      {notice && <p className="octo-board-version-notice">{notice}</p>}

      {preview && (
        <div className="octo-board-version-preview-wrap" style={{ marginBottom: 12 }}>
          <div className="octo-comment-actions" style={{ marginBottom: 6 }}>
            <strong style={{ flex: 1 }}>
              {t('docs.board.version.preview')} · #{preview.seq}
            </strong>
            <button type="button" className="octo-tb-btn" onClick={() => setPreview(null)}>
              {t('docs.board.version.closePreview')}
            </button>
          </div>
          <BoardScenePreview scene={preview.scene} dark={dark} />
        </div>
      )}

      {loading && items.length === 0 && <p className="octo-loading">{t('docs.board.version.loading')}</p>}
      {!loading && items.length === 0 && <p className="octo-comment-empty">{t('docs.board.version.empty')}</p>}

      <ul className="octo-comment-list">
        {items.map((v) => (
          <li
            key={v.docVersionSeq}
            className={`octo-comment-thread${preview?.seq === v.docVersionSeq ? ' is-selected' : ''}`}
          >
            <div className="octo-comment-head">
              <span className="octo-comment-quote">{v.label || `#${v.docVersionSeq}`}</span>
              <span className="octo-comment-time" title={formatAbsolute(v.createdAt)}>
                {kindLabel(v.kind)} · {formatRelative(v.createdAt)}
              </span>
            </div>
            <div className="octo-uid" style={{ fontSize: 12, opacity: 0.7 }}>
              {nameOf(v.createdBy)}
            </div>
            <div className="octo-comment-actions">
              <button
                type="button"
                className="octo-tb-btn"
                disabled={previewLoading}
                onClick={() => void onPreview(v.docVersionSeq)}
              >
                {t('docs.board.version.preview')}
              </button>
              {canManage(role) && (
                <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => void onRestore(v.docVersionSeq)}>
                  {t('docs.board.version.restore')}
                </button>
              )}
              {canEdit(role) && v.kind === 'named' && (
                <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => void onRename(v.docVersionSeq, v.label)}>
                  {t('docs.board.version.rename')}
                </button>
              )}
              {canManage(role) && (
                <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => void onDelete(v.docVersionSeq)}>
                  {t('docs.board.version.delete')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {nextCursor != null && (
        <div className="octo-member-row" style={{ justifyContent: 'center' }}>
          <button type="button" className="octo-tb-btn" disabled={loadingMore} onClick={() => void onLoadMore()}>
            {t('docs.board.version.loadMore')}
          </button>
        </div>
      )}
    </section>
  )
}
