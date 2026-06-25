import { useEffect, useState, useCallback, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import type { Role } from '../auth/roles.ts'
import { canSnapshot, canRestoreVersion } from '../auth/roles.ts'
import { buildPreviewExtensions } from '../editor/extensions.ts'
import {
  listVersions,
  createNamedVersion,
  getVersionState,
  restoreVersion,
  renameVersion,
  deleteVersion,
  VersionSchemaIncompatibleError,
  VersionSchemaNewerError,
  type VersionMeta,
  type VersionCounts,
} from './api.ts'
import { createPreviewGuard } from './previewGuard.ts'
import { diffDocs, type DiffEntry, type PMNode } from './diff.ts'
import { formatRelative, formatAbsolute, autosaveLabel } from './format.ts'
import { t } from '../octoweb/index.ts'

const PAGE_SIZE = 25

/** Read-only render of a historical version, built on a THROWAWAY editor (never the live one). */
function VersionPreview({ docId, content }: { docId: string; content: PMNode }) {
  const editor = useEditor(
    {
      editable: false,
      extensions: buildPreviewExtensions(docId),
      content: content as unknown as Record<string, unknown>,
    },
    [docId, content],
  )
  return <EditorContent editor={editor} className="octo-prose octo-version-preview" />
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

/**
 * Right-side version-history drawer (feature #4 §1). Visible to all roles (reader+) — the
 * live editor (`editor` prop) is read but NEVER mutated: preview/diff decode version blobs
 * into a throwaway doc, and restore reconciles server-side via normal Yjs sync.
 */
export function VersionPanel({
  docId,
  role,
  editor,
  names,
  onClose,
}: {
  docId: string
  role: Role
  /** Live editor — read-only here; used as the "current" side of a diff. */
  editor?: Editor
  /** uid → display-name map (feature #7) so the author shows a name, not a raw uid. */
  names?: Map<string, string>
  onClose?: () => void
}) {
  // Two independent streams (item 3): manual (named + restore) and auto (autosaves). Each
  // owns its items / cursor / loading so one group's "load more" never displaces the other.
  const [manualItems, setManualItems] = useState<VersionMeta[]>([])
  const [manualCursor, setManualCursor] = useState<number | null>(null)
  const [manualLoading, setManualLoading] = useState(false)
  const [manualExpanded, setManualExpanded] = useState(true)
  const [autoItems, setAutoItems] = useState<VersionMeta[]>([])
  const [autoCursor, setAutoCursor] = useState<number | null>(null)
  const [autoLoading, setAutoLoading] = useState(false)
  // Auto group is collapsed by default and lazy: its stream is only fetched the first time the
  // group is expanded, so opening the panel never pulls a long tail of autosave rows.
  const [autoExpanded, setAutoExpanded] = useState(false)
  const [autoLoaded, setAutoLoaded] = useState(false)
  // Full per-kind history counts (server-computed, not page-limited); read from any list response.
  const [counts, setCounts] = useState<VersionCounts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [selected, setSelected] = useState<VersionMeta | null>(null)
  const [previewJSON, setPreviewJSON] = useState<PMNode | null>(null)
  const [previewState, setPreviewState] = useState<
    'idle' | 'loading' | 'ready' | 'schema-error' | 'network-error'
  >('idle')
  // Which 409 schema code surfaced, so the schema-error message can be specific.
  const [schemaErrorKind, setSchemaErrorKind] = useState<'incompatible' | 'newer'>('incompatible')
  const [compare, setCompare] = useState(false)

  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [snapshotLabel, setSnapshotLabel] = useState('')
  const [renamingSeq, setRenamingSeq] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmRestore, setConfirmRestore] = useState<VersionMeta | null>(null)
  const [busy, setBusy] = useState(false)

  // Monotonic last-write-wins guard for the latest in-flight preview request.
  const previewGuardRef = useRef(createPreviewGuard())

  const mySnapshot = canSnapshot(role)
  const myRestore = canRestoreVersion(role)

  const loadManual = useCallback(async () => {
    setManualLoading(true)
    setError(null)
    try {
      const res = await listVersions(docId, { kind: 'manual', limit: PAGE_SIZE })
      setManualItems(res.items)
      setManualCursor(res.nextCursor)
      if (res.counts) setCounts(res.counts)
    } catch {
      setError(t('docs.version.errorList'))
    } finally {
      setManualLoading(false)
    }
  }, [docId])

  const loadAuto = useCallback(async () => {
    setAutoLoading(true)
    setError(null)
    try {
      const res = await listVersions(docId, { kind: 'auto', limit: PAGE_SIZE })
      setAutoItems(res.items)
      setAutoCursor(res.nextCursor)
      setAutoLoaded(true)
      if (res.counts) setCounts(res.counts)
    } catch {
      setError(t('docs.version.errorList'))
    } finally {
      setAutoLoading(false)
    }
  }, [docId])

  // Reload after a mutation (snapshot / rename / delete / restore). Always refresh the manual
  // stream + counts; refresh the auto stream too only if it's already been loaded, so a restore's
  // new auto safety-version shows without forcing the (lazy) auto group open.
  const refresh = useCallback(async () => {
    await loadManual()
    if (autoLoaded) await loadAuto()
  }, [loadManual, loadAuto, autoLoaded])

  useEffect(() => {
    void loadManual()
  }, [loadManual])

  function toggleAuto() {
    const next = !autoExpanded
    setAutoExpanded(next)
    // First expansion triggers the lazy fetch of the auto stream.
    if (next && !autoLoaded && !autoLoading) void loadAuto()
  }

  async function loadMoreManual() {
    if (manualCursor == null || manualLoading) return
    setManualLoading(true)
    try {
      const res = await listVersions(docId, { kind: 'manual', cursor: manualCursor, limit: PAGE_SIZE })
      setManualItems((prev) => [...prev, ...res.items])
      setManualCursor(res.nextCursor)
      if (res.counts) setCounts(res.counts)
    } catch {
      setError(t('docs.version.errorMore'))
    } finally {
      setManualLoading(false)
    }
  }

  async function loadMoreAuto() {
    if (autoCursor == null || autoLoading) return
    setAutoLoading(true)
    try {
      const res = await listVersions(docId, { kind: 'auto', cursor: autoCursor, limit: PAGE_SIZE })
      setAutoItems((prev) => [...prev, ...res.items])
      setAutoCursor(res.nextCursor)
      if (res.counts) setCounts(res.counts)
    } catch {
      setError(t('docs.version.errorMore'))
    } finally {
      setAutoLoading(false)
    }
  }

  async function onPreview(v: VersionMeta) {
    setSelected(v)
    setCompare(false)
    setPreviewState('loading')
    setPreviewJSON(null)
    setError(null)
    // Stale-response guard: a slow response for an earlier version (user clicked A
    // then quickly clicked B) must NOT overwrite the now-selected version's
    // preview/diff — otherwise the panel would render #A's content under a
    // "Preview #B" header and mislead an admin's restore decision (adjacent to the
    // restore red line). Only the latest request may apply its result.
    const { isCurrent } = previewGuardRef.current.begin()
    try {
      const resp = await getVersionState(docId, v.docVersionSeq)
      if (!isCurrent()) return // superseded by a newer preview
      setPreviewJSON(resp.doc)
      setPreviewState('ready')
    } catch (e) {
      if (!isCurrent()) return // superseded; swallow stale error
      if (e instanceof VersionSchemaNewerError) {
        setSchemaErrorKind('newer')
        setPreviewState('schema-error')
      } else if (e instanceof VersionSchemaIncompatibleError) {
        setSchemaErrorKind('incompatible')
        setPreviewState('schema-error')
      } else {
        setPreviewState('network-error')
      }
    }
  }

  // "Current" side of a diff: the live editor's JSON (read-only).
  function currentDoc(): PMNode | null {
    if (editor) return editor.getJSON() as PMNode
    return null
  }

  const diff: DiffEntry[] | null =
    compare && previewJSON ? diffDocs(previewJSON, currentDoc()) : null

  async function onCreateSnapshot() {
    setBusy(true)
    setError(null)
    try {
      await createNamedVersion(docId, snapshotLabel)
      setSnapshotOpen(false)
      setSnapshotLabel('')
      await refresh()
    } catch {
      setError(t('docs.version.errorSave'))
    } finally {
      setBusy(false)
    }
  }

  async function onRename(seq: number) {
    setBusy(true)
    setError(null)
    try {
      await renameVersion(docId, seq, renameValue.trim())
      setRenamingSeq(null)
      setRenameValue('')
      await refresh()
    } catch {
      setError(t('docs.version.errorRename'))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(v: VersionMeta) {
    if (!window.confirm(t('docs.version.deleteConfirm', { values: { seq: v.docVersionSeq } }))) return
    setBusy(true)
    setError(null)
    try {
      await deleteVersion(docId, v.docVersionSeq)
      if (selected?.docVersionSeq === v.docVersionSeq) {
        setSelected(null)
        setPreviewJSON(null)
        setPreviewState('idle')
      }
      await refresh()
    } catch {
      setError(t('docs.version.errorDelete'))
    } finally {
      setBusy(false)
    }
  }

  async function onConfirmRestore(v: VersionMeta) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await restoreVersion(docId, v.docVersionSeq)
      setConfirmRestore(null)
      setNotice(
        t('docs.version.restoredNotice', {
          values: { from: res.restoredFrom, seq: res.newDocVersionSeq },
        }),
      )
      await refresh()
    } catch (e) {
      if (e instanceof VersionSchemaIncompatibleError || e instanceof VersionSchemaNewerError) {
        setError(t('docs.version.errorRestoreIncompatible'))
      } else {
        setError(t('docs.version.errorRestore'))
      }
      setConfirmRestore(null)
    } finally {
      setBusy(false)
    }
  }

  // Close the preview/compare modal: clear the selection + reset the preview machine so a
  // re-open starts clean. Restore is unaffected (it's triggered from the row, not the modal).
  const closePreview = useCallback(() => {
    setSelected(null)
    setPreviewJSON(null)
    setPreviewState('idle')
    setCompare(false)
  }, [])

  // Escape closes the preview modal (mirrors the manage-members modal convention).
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected, closePreview])

  // One history row (kind-agnostic): preview opens the modal, restore/rename/delete act in place.
  // Shared verbatim between the manual and auto groups so auto rows are equally previewable/restorable.
  function renderRow(v: VersionMeta) {
    const isSelected = selected?.docVersionSeq === v.docVersionSeq
    const renameable = mySnapshot && v.kind === 'named'
    return (
      <li
        key={v.docVersionSeq}
        className={`octo-version-row octo-version-row-${v.kind}${isSelected ? ' is-selected' : ''}`}
      >
        <div className="octo-version-line1">
          <span className={`octo-version-badge octo-version-badge-${v.kind}`}>{kindBadge(v)}</span>
          {renamingSeq === v.docVersionSeq ? (
            <input
              className="octo-uid"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
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
          <span className="octo-version-author">{names?.get(v.createdBy) || v.createdBy}</span>
          <div className="octo-version-actions">
            {renamingSeq === v.docVersionSeq ? (
              <>
                <button
                  type="button"
                  className="octo-tb-btn"
                  disabled={busy || renameValue.trim() === ''}
                  onClick={() => onRename(v.docVersionSeq)}
                >
                  {t('docs.version.save')}
                </button>
                <button type="button" className="octo-tb-btn" onClick={() => setRenamingSeq(null)}>
                  {t('docs.version.cancel')}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="octo-tb-btn" onClick={() => onPreview(v)}>
                  {t('docs.version.preview')}
                </button>
                {renameable && (
                  <button
                    type="button"
                    className="octo-tb-btn"
                    onClick={() => {
                      setRenamingSeq(v.docVersionSeq)
                      setRenameValue(v.label)
                    }}
                  >
                    {t('docs.version.rename')}
                  </button>
                )}
                {myRestore && (
                  <button
                    type="button"
                    className="octo-tb-btn"
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
                    onClick={() => onDelete(v)}
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

  // Manual-stream header count = named + restore rows (the manual stream carries both); auto = autosaves.
  const manualCount = counts ? counts.manual + counts.restore : manualItems.length
  const autoCount = counts ? counts.auto : autoItems.length

  return (
    <>
    <section className="octo-version-panel">
      <div className="octo-member-row">
        <h3 style={{ flex: 1, margin: 0 }}>{t('docs.version.title')}</h3>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            {t('docs.version.close')}
          </button>
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
              <button type="button" className="octo-tb-btn" disabled={busy} onClick={onCreateSnapshot}>
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
            <button type="button" className="octo-tb-btn" onClick={() => setSnapshotOpen(true)}>
              {t('docs.version.saveCurrent')}
            </button>
          )}
        </div>
      )}

      {notice && <p className="octo-version-notice">{notice}</p>}
      {error && <p className="octo-member-error">{error}</p>}

      {/* Manual versions (named + restore) — expanded by default. */}
      <div className="octo-version-group octo-version-group-manual">
        <button
          type="button"
          className="octo-version-group-header"
          aria-expanded={manualExpanded}
          onClick={() => setManualExpanded((e) => !e)}
        >
          <span className="octo-version-group-caret">{manualExpanded ? '▾' : '▸'}</span>
          <span className="octo-version-group-title">{t('docs.version.manualGroup')}</span>
          <span className="octo-version-group-count">({manualCount})</span>
        </button>
        {manualExpanded && (
          <>
            {manualLoading && manualItems.length === 0 && (
              <p className="octo-loading">{t('docs.version.loadingList')}</p>
            )}
            {!manualLoading && manualItems.length === 0 && (
              <p className="octo-version-empty">{t('docs.version.empty')}</p>
            )}
            <ul className="octo-version-list">{manualItems.map(renderRow)}</ul>
            {manualCursor != null && (
              <button
                type="button"
                className="octo-tb-btn"
                disabled={manualLoading}
                onClick={loadMoreManual}
              >
                {t('docs.version.loadMore')}
              </button>
            )}
          </>
        )}
      </div>

      {/* Auto snapshots — collapsed by default, stream lazily fetched on first expand. */}
      <div className="octo-version-group octo-version-group-auto">
        <button
          type="button"
          className="octo-version-group-header"
          aria-expanded={autoExpanded}
          onClick={toggleAuto}
        >
          <span className="octo-version-group-caret">{autoExpanded ? '▾' : '▸'}</span>
          <span className="octo-version-group-title">{t('docs.version.autoGroup')}</span>
          <span className="octo-version-group-count">({autoCount})</span>
        </button>
        {autoExpanded && (
          <>
            {autoLoading && autoItems.length === 0 && (
              <p className="octo-loading">{t('docs.version.loadingList')}</p>
            )}
            {!autoLoading && autoLoaded && autoItems.length === 0 && (
              <p className="octo-version-empty">{t('docs.version.emptyAuto')}</p>
            )}
            <ul className="octo-version-list">{autoItems.map(renderRow)}</ul>
            {autoCursor != null && (
              <button
                type="button"
                className="octo-tb-btn"
                disabled={autoLoading}
                onClick={loadMoreAuto}
              >
                {t('docs.version.loadMore')}
              </button>
            )}
          </>
        )}
      </div>

      {confirmRestore && (
        <div className="octo-version-confirm">
          <p>{t('docs.version.confirmTitle', { values: { seq: confirmRestore.docVersionSeq } })}</p>
          <p className="octo-version-confirm-detail">{t('docs.version.confirmDetail')}</p>
          <div className="octo-member-row">
            <button
              type="button"
              className="octo-tb-btn"
              disabled={busy}
              onClick={() => onConfirmRestore(confirmRestore)}
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
              <button
                type="button"
                className="octo-tb-btn"
                disabled={previewState !== 'ready'}
                onClick={() => setCompare((c) => !c)}
              >
                {compare ? t('docs.version.showPreview') : t('docs.version.compare')}
              </button>
              <button type="button" className="octo-tb-btn" onClick={closePreview}>
                {t('docs.version.close')}
              </button>
            </div>

            <div className="docs-version-preview-modal-body">
              {previewState === 'loading' && <p className="octo-loading">{t('docs.version.loadingPreview')}</p>}
              {previewState === 'schema-error' && (
                <p className="octo-member-error">
                  {t(
                    schemaErrorKind === 'newer'
                      ? 'docs.version.previewSchemaNewer'
                      : 'docs.version.previewSchemaIncompatible',
                  )}
                </p>
              )}
              {previewState === 'network-error' && (
                <div className="octo-version-preview-error">
                  <p className="octo-member-error">{t('docs.version.previewNetworkError')}</p>
                  <button
                    type="button"
                    className="octo-tb-btn"
                    onClick={() => selected && onPreview(selected)}
                  >
                    {t('docs.version.previewRetry')}
                  </button>
                </div>
              )}

              {previewState === 'ready' && previewJSON && !compare && (
                <VersionPreview docId={docId} content={previewJSON} />
              )}

              {previewState === 'ready' && compare && diff && <DiffView diff={diff} />}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** Block-level diff render: added / removed / changed / unchanged rows (feature #4 §1.4). */
function DiffView({ diff }: { diff: DiffEntry[] }) {
  if (diff.length === 1 && diff[0].type === 'too-large') {
    return (
      <p className="octo-version-empty">{t('docs.version.tooLarge')}</p>
    )
  }
  if (diff.every((d) => d.type === 'unchanged')) {
    return <p className="octo-version-empty">{t('docs.version.noChanges')}</p>
  }
  return (
    <div className="octo-version-diff">
      {diff.map((d, i) => {
        if (d.type === 'changed') {
          return (
            <div key={i} className="octo-diff-changed">
              <div className="octo-diff-line octo-diff-removed">- {d.before}</div>
              <div className="octo-diff-line octo-diff-added">+ {d.after}</div>
            </div>
          )
        }
        const sign = d.type === 'added' ? '+' : d.type === 'removed' ? '-' : ' '
        return (
          <div key={i} className={`octo-diff-line octo-diff-${d.type}`}>
            {sign} {d.text || ' '}
          </div>
        )
      })}
    </div>
  )
}
