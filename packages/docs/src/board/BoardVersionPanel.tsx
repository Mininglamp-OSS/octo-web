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

import { useCallback, useEffect, useRef, useState } from 'react'
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
import { BoardErrorBoundary } from './BoardErrorBoundary.tsx'

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

  // Inline rename compose row (same pattern as the save row above). A native window.prompt does not
  // reliably surface here — it is dismissed by headless automation and reads awkwardly over the
  // modal — so renaming a named version turns its action area into a name input + save/cancel.
  const [renamingSeq, setRenamingSeq] = useState<number | null>(null)
  const [renameLabel, setRenameLabel] = useState('')

  const [preview, setPreview] = useState<{ seq: number; scene: BoardVersionScene } | null>(null)
  // Which row's preview is currently in flight (null = none). Scoped to the requesting row so a
  // second Preview click can preempt the first — a single global "loading" flag would disable EVERY
  // row's button and the abort/generation guard below could never actually fire through the UI.
  const [previewingSeq, setPreviewingSeq] = useState<number | null>(null)

  const nameOf = (uid: string) => names?.get(uid) || uid

  // Late-response guards. Both the list refresh and the preview can be fired repeatedly (rapid
  // filter switches, previewing A then B) and the responses may land out of order over the network.
  // Each fire bumps a monotonic generation and aborts the prior in-flight request; a response whose
  // generation is no longer current is discarded, so a slow earlier call can never overwrite the
  // selection made by a newer one. Load-more shares the refresh generation: a page that resolves
  // after a filter switch / restore / delete replaced the list is dropped rather than appended.
  const refreshGen = useRef(0)
  const refreshAbort = useRef<AbortController | null>(null)
  const loadMoreAbort = useRef<AbortController | null>(null)
  const previewGen = useRef(0)
  const previewAbort = useRef<AbortController | null>(null)

  // Reload the first page for the current filter. Returns whether the fresh list was applied, so a
  // caller that just performed a mutation can tell an in-place refresh failure (list may be stale,
  // a soft state) apart from the mutation itself failing. `soft` suppresses the red load error for
  // that post-mutation case. Clears any lingering notice at the top (a stale success/notice must not
  // survive a filter switch or reload).
  const refresh = useCallback(
    async (opts?: { soft?: boolean }): Promise<boolean> => {
      refreshAbort.current?.abort()
      loadMoreAbort.current?.abort()
      const controller = new AbortController()
      refreshAbort.current = controller
      const gen = ++refreshGen.current
      setLoading(true)
      setError(null)
      setNotice(null)
      try {
        const res = await listVersions(docId, { kind, limit: PAGE, signal: controller.signal })
        if (gen !== refreshGen.current) return false
        setItems(res.items)
        setNextCursor(res.nextCursor)
        setCounts(res.counts ?? null)
        return true
      } catch {
        if (gen !== refreshGen.current) return false
        if (!opts?.soft) setError(t('docs.board.version.errLoad'))
        return false
      } finally {
        if (gen === refreshGen.current) setLoading(false)
      }
    },
    [docId, kind],
  )
  useEffect(() => {
    void refresh()
  }, [refresh])

  const onLoadMore = async () => {
    if (loadingMore || nextCursor == null) return
    loadMoreAbort.current?.abort()
    const controller = new AbortController()
    loadMoreAbort.current = controller
    // Bind this page to the current refresh generation. If a filter switch / restore / delete bumps
    // the generation before it lands, the page belongs to a list that no longer exists — drop it
    // rather than append the old filter's rows and clobber the freshly-replaced nextCursor.
    const gen = refreshGen.current
    setLoadingMore(true)
    setError(null)
    try {
      const res = await listVersions(docId, { kind, cursor: nextCursor, limit: PAGE, signal: controller.signal })
      if (gen !== refreshGen.current) return
      setItems((cur) => [...cur, ...res.items])
      setNextCursor(res.nextCursor)
      if (res.counts) setCounts(res.counts)
    } catch {
      if (gen !== refreshGen.current) return
      setError(t('docs.board.version.errLoad'))
    } finally {
      if (gen === refreshGen.current) setLoadingMore(false)
    }
  }

  const onCreateSnapshot = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await createNamedVersion(docId, snapshotLabel.trim() || undefined)
    } catch {
      setError(t('docs.board.version.errSave'))
      setBusy(false)
      return
    }
    // The snapshot landed on the server. From here a refresh failure is NOT a save failure — surface
    // it as a soft "list may be stale" notice rather than the red "save failed" error.
    setSnapshotOpen(false)
    setSnapshotLabel('')
    const ok = await refresh({ soft: true })
    if (!ok) setNotice(t('docs.board.version.staleNotice'))
    setBusy(false)
  }

  const onPreview = async (seq: number) => {
    previewAbort.current?.abort()
    const controller = new AbortController()
    previewAbort.current = controller
    const gen = ++previewGen.current
    setPreviewingSeq(seq)
    setError(null)
    setNotice(null)
    try {
      const state = await getBoardVersionState(docId, seq, controller.signal)
      if (gen !== previewGen.current) return
      setPreview({ seq, scene: state.scene })
    } catch (e) {
      if (gen !== previewGen.current) return
      setError(t(versionErrorKey(e, 'docs.board.version.errPreview')))
    } finally {
      if (gen === previewGen.current) setPreviewingSeq(null)
    }
  }

  const onRestore = async (seq: number) => {
    if (!window.confirm(t('docs.board.version.restoreConfirm'))) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await restoreVersion(docId, seq)
    } catch (e) {
      setError(t(versionErrorKey(e, 'docs.board.version.errRestore')))
      setBusy(false)
      return
    }
    // Restore landed. A follow-up refresh failure means the panel list may be stale — the board still
    // reconciles via Yjs — so show the restored notice (or the soft stale notice), never "restore failed".
    setPreview(null)
    const ok = await refresh({ soft: true })
    setNotice(t(ok ? 'docs.board.version.restoredNotice' : 'docs.board.version.staleNotice'))
    onRestored?.()
    setBusy(false)
  }

  const beginRename = (seq: number, cur: string) => {
    setRenamingSeq(seq)
    setRenameLabel(cur)
  }

  const cancelRename = () => {
    setRenamingSeq(null)
    setRenameLabel('')
  }

  const commitRename = async (seq: number) => {
    const label = renameLabel.trim()
    if (label === '') return
    setBusy(true)
    setError(null)
    try {
      await renameVersion(docId, seq, label)
    } catch (e) {
      // Use the typed classifier so 403/409 surface a specific message, matching restore/delete/preview.
      setError(t(versionErrorKey(e, 'docs.board.version.errRename')))
      setBusy(false)
      return
    }
    // Optimistically reflect the new label so the row updates immediately, then refetch to reconcile
    // with server ordering/counts; a refresh failure here is soft (rename already landed).
    setItems((cur) => cur.map((v) => (v.docVersionSeq === seq ? { ...v, label } : v)))
    cancelRename()
    const ok = await refresh({ soft: true })
    if (!ok) setNotice(t('docs.board.version.staleNotice'))
    setBusy(false)
  }

  const onDelete = async (seq: number) => {
    if (!window.confirm(t('docs.board.version.deleteConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      await deleteVersion(docId, seq)
    } catch (e) {
      setError(t(versionErrorKey(e, 'docs.board.version.errDelete')))
      setBusy(false)
      return
    }
    if (preview?.seq === seq) setPreview(null)
    if (renamingSeq === seq) cancelRename()
    // Optimistically drop the row, then refetch to reconcile counts/pagination; refresh failure is soft.
    setItems((cur) => cur.filter((v) => v.docVersionSeq !== seq))
    const ok = await refresh({ soft: true })
    if (!ok) setNotice(t('docs.board.version.staleNotice'))
    setBusy(false)
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
      disabled={loading || loadingMore}
      onClick={() => {
        // Switching filter reloads the list; drop the open preview (it belongs to the previous
        // result set) and let the ensuing refresh clear any lingering notice.
        if (k !== kind) setPreview(null)
        setKind(k)
      }}
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
          {/* key={preview.seq} remounts the preview per version: Excalidraw seeds from initialData
              only once at mount (it does not reactively consume props — see the XIN-115 note in
              BoardShell), so without a keyed remount switching versions would keep showing the
              previously previewed scene while the header advanced.
              The preview is a SECOND real Excalidraw; wrap it in the same BoardErrorBoundary the live
              canvas uses so a render-time throw (malformed historical initialData, a bad restore, a
              mount failure) degrades to a recoverable message instead of unmounting the whole host. */}
          <BoardErrorBoundary key={preview.seq}>
            <BoardScenePreview scene={preview.scene} dark={dark} docId={docId} />
          </BoardErrorBoundary>
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
            {renamingSeq === v.docVersionSeq ? (
              <div className="octo-comment-actions octo-board-version-rename">
                <input
                  className="octo-uid"
                  style={{ flex: 1 }}
                  placeholder={t('docs.board.version.renamePrompt')}
                  value={renameLabel}
                  onChange={(e) => setRenameLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename(v.docVersionSeq)
                    else if (e.key === 'Escape') cancelRename()
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy || renameLabel.trim() === ''}
                  onClick={() => void commitRename(v.docVersionSeq)}
                >
                  {t('docs.board.version.saveAction')}
                </button>
                <button type="button" className="octo-tb-btn" disabled={busy} onClick={cancelRename}>
                  {t('docs.board.version.cancel')}
                </button>
              </div>
            ) : (
              <div className="octo-comment-actions">
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={previewingSeq === v.docVersionSeq}
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
                  <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => beginRename(v.docVersionSeq, v.label)}>
                    {t('docs.board.version.rename')}
                  </button>
                )}
                {canManage(role) && (
                  <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => void onDelete(v.docVersionSeq)}>
                    {t('docs.board.version.delete')}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {nextCursor != null && (
        <div className="octo-member-row" style={{ justifyContent: 'center' }}>
          <button type="button" className="octo-tb-btn" disabled={loading || loadingMore} onClick={() => void onLoadMore()}>
            {t('docs.board.version.loadMore')}
          </button>
        </div>
      )}
    </section>
  )
}
