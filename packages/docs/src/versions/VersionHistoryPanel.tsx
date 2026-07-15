// Unified version-history shell (XIN-836 交付物① / 拆单阶段 1).
//
// This is the single container that the doc, sheet and board version panels will each become a
// thin adapter over. It owns everything that is identical across the three ends — list + filter
// tabs + counts + pagination, save / rename / delete / restore, the restore confirm box, the
// unified race guard, and the centered preview / diff modal (Esc / overlay-close / focus) — and
// leaves each end to inject ONLY what is genuinely end-specific: how to load one version's state,
// how to render its preview, how to render its diff, and what "current" is.
//
// It changes NOTHING for users yet: this phase adds the shell and its guard util + tests, and does
// not wire any end to it (the doc/sheet/board panels are untouched, so there is zero visible
// change until an adapter phase switches an end over).
//
// Reuse contract (unchanged by design): list / create / rename / delete / restore all go through
// the shared REST layer in ./api.ts — the shell adds NO new endpoint. Preview alone is pluggable
// because each end decodes a different payload (PM-JSON doc / sheet cells / board scene).
//
// i18n: this shell reuses the existing `docs.version.*` message keys. A handful of new keys it
// references — filterAll / filterManual / filterAuto, countManual / countAuto, and staleNotice —
// are intentionally NOT added in this phase: the acceptance gate keeps this phase's diff to new
// files + tests only, and the shell is not mounted anywhere yet, so no user ever sees a raw key.
// Those keys land in the doc-adapter phase, when an end first renders the shell.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Role } from '../auth/roles.ts'
import { canSnapshot, canRestoreVersion } from '../auth/roles.ts'
import { t } from '../octoweb/index.ts'
import { formatRelative, formatAbsolute, autosaveLabel } from './format.ts'
import {
  listVersions,
  createNamedVersion,
  restoreVersion,
  renameVersion,
  deleteVersion,
  VersionSchemaIncompatibleError,
  VersionSchemaNewerError,
  type VersionMeta,
  type VersionCounts,
} from './api.ts'
import { createRaceGuard } from './raceGuard.ts'

export type KindFilter = 'all' | 'manual' | 'auto'

/** Default page size when a host does not override it (doc 25 / board 30 / sheet 50 → unify at 30). */
const DEFAULT_PAGE_SIZE = 30

export interface VersionHistoryPanelProps<TState, TCurrent> {
  docId: string
  role: Role
  /** uid → display-name map so a row's author shows a name, not a raw uid. */
  names?: Map<string, string>
  onClose?: () => void

  // —— list data source (always the shared listVersions; knobs only) ——
  pageSize?: number
  defaultFilter?: KindFilter

  // —— change hooks (all mutations reuse ./api.ts; these only tune error text / post-effects) ——
  /** Called after a successful restore (board refreshes chrome; doc/sheet may omit). */
  onRestored?: () => void
  /** Map a preview error to an i18n key (board passes versionErrorKey; default handles schema/network). */
  previewErrorKey?: (e: unknown) => string
  /** Map a restore error to an i18n key (same default; board passes its richer classifier). */
  restoreErrorKey?: (e: unknown) => string

  // —— preview / diff (the pluggable core) ——
  /** Load one version's decoded state for preview/diff. MUST honor the AbortSignal. */
  loadPreviewState: (seq: number, signal: AbortSignal) => Promise<TState>
  /** Render the read-only preview of a loaded state (throwaway editor / grid / scene). */
  renderPreview: (state: TState) => ReactNode
  /** Render the diff of a version against current. Omit → the modal hides the "compare" entry. */
  renderDiff?: (state: TState, current: TCurrent | null) => ReactNode
  /** The "current" side of a diff (live editor JSON / sheet cells). Omit when there is no diff. */
  getCurrent?: () => TCurrent | null
}

/** Preview modal state machine — end-agnostic (the payload itself is TState, held separately). */
type PreviewState = 'idle' | 'loading' | 'ready' | 'error'

/** Default error → i18n key mapping when a host does not inject its own classifier. */
function defaultErrorKey(e: unknown): string {
  if (e instanceof VersionSchemaNewerError) return 'docs.version.previewSchemaNewer'
  if (e instanceof VersionSchemaIncompatibleError) return 'docs.version.previewSchemaIncompatible'
  return 'docs.version.previewNetworkError'
}

function kindBadge(v: VersionMeta): string {
  if (v.kind === 'named') return t('docs.version.badgeNamed')
  if (v.kind === 'restore-marker') {
    return v.restoredFrom != null
      ? t('docs.version.badgeRestoredFrom', { values: { from: v.restoredFrom } })
      : t('docs.version.badgeRestored')
  }
  return t('docs.version.badgeAuto')
}

function displayLabel(v: VersionMeta): string {
  if (v.label && v.label.trim() !== '') return v.label
  if (v.kind === 'restore-marker') {
    return v.restoredFrom != null
      ? t('docs.version.labelRestoredFrom', { values: { from: v.restoredFrom } })
      : t('docs.version.labelRestored')
  }
  return autosaveLabel(v.createdAt)
}

export function VersionHistoryPanel<TState, TCurrent>({
  docId,
  role,
  names,
  onClose,
  pageSize = DEFAULT_PAGE_SIZE,
  defaultFilter = 'all',
  onRestored,
  previewErrorKey,
  restoreErrorKey,
  loadPreviewState,
  renderPreview,
  renderDiff,
  getCurrent,
}: VersionHistoryPanelProps<TState, TCurrent>) {
  const [items, setItems] = useState<VersionMeta[]>([])
  const [counts, setCounts] = useState<VersionCounts | null>(null)
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [filter, setFilter] = useState<KindFilter>(defaultFilter)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Inline "save current version" compose row (no native prompt — unified across ends).
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [snapshotLabel, setSnapshotLabel] = useState('')

  // Inline rename compose row (replaces the sheet panel's native window.prompt).
  const [renamingSeq, setRenamingSeq] = useState<number | null>(null)
  const [renameLabel, setRenameLabel] = useState('')

  // Restore is confirmed in a centered in-panel box (doc model), not a native window.confirm.
  const [confirmRestore, setConfirmRestore] = useState<VersionMeta | null>(null)
  // Delete is likewise confirmed in the same in-panel box (was a native window.confirm) so the
  // destructive-action UX is unified across doc/sheet/board rather than falling back to the browser.
  const [confirmDelete, setConfirmDelete] = useState<VersionMeta | null>(null)

  // Centered preview / diff modal.
  const [selected, setSelected] = useState<VersionMeta | null>(null)
  const [previewData, setPreviewData] = useState<TState | null>(null)
  const [previewState, setPreviewState] = useState<PreviewState>('idle')
  const [previewErr, setPreviewErr] = useState<string>('docs.version.previewNetworkError')
  const [compare, setCompare] = useState(false)

  // One guard for the list (refresh = primary, load-more = follow-up) and an independent one for
  // preview — both from the shared createRaceGuard so all three chains abort + last-write-win.
  const listGuard = useRef(createRaceGuard())
  const previewGuard = useRef(createRaceGuard())
  // Liveness flag: mutation handlers setState after an await, and refresh()/the guards only cover
  // their own async chains — this guards the trailing setBusy/setNotice/onRestored in the handlers
  // so they no-op if the panel unmounted mid-flight (no setState-after-unmount).
  const mounted = useRef(true)

  const mySnapshot = canSnapshot(role)
  const myRestore = canRestoreVersion(role)
  const nameOf = (uid: string) => names?.get(uid) || uid
  // Compare is only offered when the host can both diff and supply "current".
  const canCompare = !!(renderDiff && getCurrent)

  // Reload the first page for the current filter. `soft` suppresses the red load error for the
  // post-mutation case (the mutation itself already succeeded; a refresh miss only means the list
  // may be stale). Returns whether the fresh list was applied.
  const refresh = useCallback(
    async (opts?: { soft?: boolean }): Promise<boolean> => {
      const { signal, isCurrent } = listGuard.current.begin()
      setLoading(true)
      setError(null)
      setNotice(null)
      try {
        const res = await listVersions(docId, { kind: filter, limit: pageSize, signal })
        if (!isCurrent()) return false
        setItems(res.items)
        setNextCursor(res.nextCursor)
        setCounts(res.counts ?? null)
        return true
      } catch {
        if (!isCurrent()) return false
        if (!opts?.soft) setError(t('docs.version.errorList'))
        return false
      } finally {
        if (isCurrent()) setLoading(false)
      }
    },
    [docId, filter, pageSize],
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Abort any in-flight request when the panel unmounts.
  useEffect(() => {
    mounted.current = true // re-arm on (re)mount so StrictMode's mount→cleanup→remount stays live
    const list = listGuard.current
    const preview = previewGuard.current
    return () => {
      mounted.current = false
      list.abort()
      preview.abort()
    }
  }, [])

  const onLoadMore = async () => {
    if (loadingMore || nextCursor == null) return
    const { signal, isCurrent } = listGuard.current.beginFollowUp()
    setLoadingMore(true)
    setError(null)
    try {
      const res = await listVersions(docId, { kind: filter, cursor: nextCursor, limit: pageSize, signal })
      // Bound to the list guard: if a refresh / filter switch / restore (begin) OR a newer
      // load-more (beginFollowUp) superseded this page before it landed, isCurrent() is false and
      // we drop it — never appending stale/duplicate rows onto a list that moved on. The follow-up
      // token in createRaceGuard is what makes the "newer load-more" case report non-current even
      // though the aborted request may have resolved a hair before its abort.
      if (!isCurrent()) return
      setItems((cur) => [...cur, ...res.items])
      setNextCursor(res.nextCursor)
      if (res.counts) setCounts(res.counts)
    } catch {
      if (!isCurrent()) return
      setError(t('docs.version.errorMore'))
    } finally {
      // Always clear the loading flag on this follow-up's own completion, independent of
      // isCurrent(). The guard's job is to discard the stale *result* (handled by the early
      // returns above); the *loading flag* must not be gated on isCurrent(), or a superseded
      // load-more (filter switch / refresh / restore while a page is in flight) would skip this
      // reset and wedge loadingMore=true forever, permanently disabling the Load More button.
      // A superseded-but-mounted setState is harmless; a genuine unmount is covered by the guard
      // util's abort; a newer load-more re-sets the flag true itself.
      setLoadingMore(false)
    }
  }

  const selectFilter = (k: KindFilter) => {
    if (k === filter) return
    // Switching filter reloads the list; drop the open preview (it belongs to the previous set).
    closePreview()
    setFilter(k)
  }

  const onCreateSnapshot = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await createNamedVersion(docId, snapshotLabel.trim() || undefined)
    } catch {
      if (!mounted.current) return
      setError(t('docs.version.errorSave'))
      setBusy(false)
      return
    }
    if (!mounted.current) return
    setSnapshotOpen(false)
    setSnapshotLabel('')
    const ok = await refresh({ soft: true })
    if (!mounted.current) return
    if (!ok) setNotice(t('docs.version.staleNotice'))
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
    } catch {
      if (!mounted.current) return
      setError(t('docs.version.errorRename'))
      setBusy(false)
      return
    }
    if (!mounted.current) return
    // Optimistic label update, then reconcile with server ordering/counts (soft: rename landed).
    setItems((cur) => cur.map((v) => (v.docVersionSeq === seq ? { ...v, label } : v)))
    cancelRename()
    const ok = await refresh({ soft: true })
    if (!mounted.current) return
    if (!ok) setNotice(t('docs.version.staleNotice'))
    setBusy(false)
  }

  const onDelete = async (v: VersionMeta) => {
    setBusy(true)
    setError(null)
    try {
      await deleteVersion(docId, v.docVersionSeq)
    } catch {
      if (!mounted.current) return
      setError(t('docs.version.errorDelete'))
      setConfirmDelete(null)
      setBusy(false)
      return
    }
    if (!mounted.current) return
    setConfirmDelete(null)
    if (selected?.docVersionSeq === v.docVersionSeq) closePreview()
    if (renamingSeq === v.docVersionSeq) cancelRename()
    setItems((cur) => cur.filter((x) => x.docVersionSeq !== v.docVersionSeq))
    const ok = await refresh({ soft: true })
    if (!mounted.current) return
    if (!ok) setNotice(t('docs.version.staleNotice'))
    setBusy(false)
  }

  const onConfirmRestore = async (v: VersionMeta) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    let res: { newDocVersionSeq: number; restoredFrom: number }
    try {
      res = await restoreVersion(docId, v.docVersionSeq)
    } catch (e) {
      if (!mounted.current) return
      setError(t(restoreErrorKey ? restoreErrorKey(e) : 'docs.version.errorRestore'))
      setConfirmRestore(null)
      setBusy(false)
      return
    }
    if (!mounted.current) return
    // Restore landed — the live surface reconciles via Yjs. A follow-up refresh miss is soft.
    setConfirmRestore(null)
    closePreview()
    const ok = await refresh({ soft: true })
    if (!mounted.current) return
    setNotice(
      ok
        ? t('docs.version.restoredNotice', { values: { from: res.restoredFrom, seq: res.newDocVersionSeq } })
        : t('docs.version.staleNotice'),
    )
    onRestored?.()
    setBusy(false)
  }

  const onPreview = async (v: VersionMeta) => {
    const { signal, isCurrent } = previewGuard.current.begin()
    setSelected(v)
    setCompare(false)
    setPreviewState('loading')
    setPreviewData(null)
    setError(null)
    setNotice(null)
    try {
      const state = await loadPreviewState(v.docVersionSeq, signal)
      if (!isCurrent()) return // superseded by a newer preview
      setPreviewData(state)
      setPreviewState('ready')
    } catch (e) {
      if (!isCurrent()) return // superseded; swallow the stale error
      setPreviewErr(previewErrorKey ? previewErrorKey(e) : defaultErrorKey(e))
      setPreviewState('error')
    }
  }

  const closePreview = useCallback(() => {
    // Abort an in-flight preview so a late response can't reopen the modal after close.
    previewGuard.current.begin()
    setSelected(null)
    setPreviewData(null)
    setPreviewState('idle')
    setCompare(false)
  }, [])

  // Escape closes the preview modal (mirrors the doc panel / manage-members convention).
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected, closePreview])

  // Escape also cancels the restore / delete confirm overlay, matching the preview modal's Esc/
  // overlay-close behavior. It only clears the confirm state (never the in-flight mutation), and it
  // no-ops while a mutation is running so a keypress can't dismiss the box mid-request.
  useEffect(() => {
    if (!confirmRestore && !confirmDelete) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      setConfirmRestore(null)
      setConfirmDelete(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [confirmRestore, confirmDelete, busy])

  const filterBtn = (k: KindFilter, label: string) => (
    <button
      type="button"
      className={filter === k ? 'octo-tb-btn is-active' : 'octo-tb-btn'}
      aria-pressed={filter === k}
      disabled={loading || loadingMore}
      onClick={() => selectFilter(k)}
    >
      {label}
    </button>
  )

  function renderRow(v: VersionMeta) {
    const isSelected = selected?.docVersionSeq === v.docVersionSeq
    const renameable = mySnapshot && v.kind === 'named'
    const isRenaming = renamingSeq === v.docVersionSeq
    return (
      <li
        key={v.docVersionSeq}
        className={`octo-version-row octo-version-row-${v.kind}${isSelected ? ' is-selected' : ''}`}
      >
        <div className="octo-version-line1">
          <span className={`octo-version-badge octo-version-badge-${v.kind}`}>{kindBadge(v)}</span>
          {isRenaming ? (
            <input
              className="octo-uid"
              value={renameLabel}
              placeholder={t('docs.version.labelPlaceholder')}
              onChange={(e) => setRenameLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename(v.docVersionSeq)
                else if (e.key === 'Escape') cancelRename()
              }}
              autoFocus
            />
          ) : (
            <span className="octo-version-label">{displayLabel(v)}</span>
          )}
          <span className="octo-version-time" title={formatAbsolute(v.createdAt)}>
            {formatRelative(v.createdAt)}
          </span>
        </div>
        <div className="octo-version-line2">
          <span className="octo-version-author">{nameOf(v.createdBy)}</span>
          <div className="octo-version-actions">
            {isRenaming ? (
              <>
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy || renameLabel.trim() === ''}
                  onClick={() => void commitRename(v.docVersionSeq)}
                >
                  {t('docs.version.save')}
                </button>
                <button type="button" className="octo-tb-btn" disabled={busy} onClick={cancelRename}>
                  {t('docs.version.cancel')}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="octo-tb-btn" onClick={() => void onPreview(v)}>
                  {t('docs.version.preview')}
                </button>
                {renameable && (
                  <button
                    type="button"
                    className="octo-tb-btn"
                    disabled={busy}
                    onClick={() => beginRename(v.docVersionSeq, v.label)}
                  >
                    {t('docs.version.rename')}
                  </button>
                )}
                {myRestore && (
                  <button
                    type="button"
                    className="octo-tb-btn"
                    disabled={busy}
                    onClick={() => setConfirmRestore(v)}
                  >
                    {t('docs.version.restore')}
                  </button>
                )}
                {myRestore && (
                  <button
                    type="button"
                    className="octo-tb-btn"
                    disabled={busy}
                    onClick={() => setConfirmDelete(v)}
                  >
                    {t('docs.version.delete')}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </li>
    )
  }

  const currentForDiff = compare && getCurrent ? getCurrent() : null

  return (
    <>
      <section className="octo-version-panel octo-version-history-panel">
        <div className="octo-member-row">
          <h3 style={{ flex: 1, margin: 0 }}>{t('docs.version.title')}</h3>
          {onClose && (
            <button type="button" className="octo-tb-btn" onClick={onClose}>
              {t('docs.version.close')}
            </button>
          )}
        </div>

        <div className="octo-member-row octo-version-filters">
          {filterBtn('all', t('docs.version.filterAll'))}
          {filterBtn('manual', t('docs.version.filterManual'))}
          {filterBtn('auto', t('docs.version.filterAuto'))}
          {counts && (
            <span className="octo-version-counts" style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.7 }}>
              {t('docs.version.countManual')} {counts.manual + counts.restore} · {t('docs.version.countAuto')} {counts.auto}
            </span>
          )}
        </div>

        {mySnapshot && (
          <div className="octo-version-save">
            {snapshotOpen ? (
              <div className="octo-member-row">
                <input
                  className="octo-uid"
                  placeholder={t('docs.version.labelPlaceholder')}
                  value={snapshotLabel}
                  onChange={(e) => setSnapshotLabel(e.target.value)}
                  autoFocus
                />
                <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => void onCreateSnapshot()}>
                  {t('docs.version.save')}
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
                  {t('docs.version.cancel')}
                </button>
              </div>
            ) : (
              <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => setSnapshotOpen(true)}>
                {t('docs.version.saveCurrent')}
              </button>
            )}
          </div>
        )}

        {notice && <p className="octo-version-notice">{notice}</p>}
        {error && <p className="octo-member-error">{error}</p>}

        {loading && items.length === 0 && <p className="octo-loading">{t('docs.version.loadingList')}</p>}
        {!loading && items.length === 0 && <p className="octo-version-empty">{t('docs.version.empty')}</p>}

        <ul className="octo-version-list">{items.map(renderRow)}</ul>

        {nextCursor != null && (
          <div className="octo-member-row" style={{ justifyContent: 'center' }}>
            <button type="button" className="octo-tb-btn" disabled={loading || loadingMore} onClick={() => void onLoadMore()}>
              {t('docs.version.loadMore')}
            </button>
          </div>
        )}

        {confirmRestore && (
          <div
            className="octo-modal-overlay octo-modal-overlay--center"
            role="presentation"
            onMouseDown={() => {
              if (!busy) setConfirmRestore(null)
            }}
          >
            <div
              className="octo-version-confirm"
              role="dialog"
              aria-modal="true"
              aria-label={t('docs.version.restore')}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <p>{t('docs.version.confirmTitle', { values: { seq: confirmRestore.docVersionSeq } })}</p>
              <p className="octo-version-confirm-detail">{t('docs.version.confirmDetail')}</p>
              <div className="octo-member-row">
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy}
                  onClick={() => void onConfirmRestore(confirmRestore)}
                >
                  {t('docs.version.restore')}
                </button>
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy}
                  onClick={() => setConfirmRestore(null)}
                >
                  {t('docs.version.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmDelete && (
          <div
            className="octo-modal-overlay octo-modal-overlay--center"
            role="presentation"
            onMouseDown={() => {
              if (!busy) setConfirmDelete(null)
            }}
          >
            <div
              className="octo-version-confirm"
              role="dialog"
              aria-modal="true"
              aria-label={t('docs.version.delete')}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <p>{t('docs.version.deleteConfirm', { values: { seq: confirmDelete.docVersionSeq } })}</p>
              <div className="octo-member-row">
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy}
                  onClick={() => void onDelete(confirmDelete)}
                >
                  {t('docs.version.delete')}
                </button>
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy}
                  onClick={() => setConfirmDelete(null)}
                >
                  {t('docs.version.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {selected && (
        <div className="octo-modal-overlay" role="presentation" onMouseDown={closePreview}>
          <div
            className="octo-modal docs-version-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={compare ? t('docs.version.compareTitle') : t('docs.version.previewTitle')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="octo-member-row">
              <h4 style={{ flex: 1, margin: 0 }}>
                {compare ? t('docs.version.compareTitle') : t('docs.version.previewTitle')} — #{selected.docVersionSeq}
              </h4>
              {canCompare && (
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={previewState !== 'ready'}
                  onClick={() => setCompare((c) => !c)}
                >
                  {compare ? t('docs.version.showPreview') : t('docs.version.compare')}
                </button>
              )}
              <button type="button" className="octo-tb-btn" onClick={closePreview}>
                {t('docs.version.close')}
              </button>
            </div>

            <div className="docs-version-preview-modal-body">
              {previewState === 'loading' && <p className="octo-loading">{t('docs.version.loadingPreview')}</p>}
              {previewState === 'error' && (
                <div className="octo-version-preview-error">
                  <p className="octo-member-error">{t(previewErr)}</p>
                  <button type="button" className="octo-tb-btn" onClick={() => selected && void onPreview(selected)}>
                    {t('docs.version.previewRetry')}
                  </button>
                </div>
              )}
              {previewState === 'ready' && previewData != null && !compare && renderPreview(previewData)}
              {previewState === 'ready' && previewData != null && compare && renderDiff && renderDiff(previewData, currentForDiff)}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
