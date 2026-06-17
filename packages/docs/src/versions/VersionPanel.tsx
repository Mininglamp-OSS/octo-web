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
} from './api.ts'
import { stateToProsemirrorJSON } from './preview.ts'
import { createPreviewGuard } from './previewGuard.ts'
import { diffDocs, type DiffEntry, type PMNode } from './diff.ts'
import { formatRelative, formatAbsolute, autosaveLabel } from './format.ts'

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
  if (v.kind === 'named') return 'named'
  if (v.kind === 'restore-marker') {
    return v.restoredFrom != null ? `restored from #${v.restoredFrom}` : 'restored'
  }
  return 'auto'
}

function displayLabel(v: VersionMeta): string {
  if (v.label && v.label.trim() !== '') return v.label
  if (v.kind === 'restore-marker') {
    return v.restoredFrom != null ? `Restored from #${v.restoredFrom}` : 'Restored'
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
  currentState,
  editor,
  onClose,
}: {
  docId: string
  role: Role
  /** Optional binary state of the current doc (diff fallback when no live editor is given). */
  currentState?: ArrayBuffer
  /** Live editor — read-only here; used as the "current" side of a diff. */
  editor?: Editor
  onClose?: () => void
}) {
  const [versions, setVersions] = useState<VersionMeta[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [selected, setSelected] = useState<VersionMeta | null>(null)
  const [previewJSON, setPreviewJSON] = useState<PMNode | null>(null)
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
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

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listVersions(docId, { limit: PAGE_SIZE })
      setVersions(res.items)
      setNextCursor(res.nextCursor)
    } catch {
      setError('Failed to load version history.')
    } finally {
      setLoading(false)
    }
  }, [docId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function loadMore() {
    if (nextCursor == null || loading) return
    setLoading(true)
    try {
      const res = await listVersions(docId, { cursor: nextCursor, limit: PAGE_SIZE })
      setVersions((prev) => [...prev, ...res.items])
      setNextCursor(res.nextCursor)
    } catch {
      setError('Failed to load more versions.')
    } finally {
      setLoading(false)
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
      const buf = await getVersionState(docId, v.docVersionSeq)
      if (!isCurrent()) return // superseded by a newer preview
      setPreviewJSON(stateToProsemirrorJSON(buf))
      setPreviewState('ready')
    } catch {
      if (!isCurrent()) return // superseded; swallow stale error
      setPreviewState('error')
    }
  }

  // "Current" side of a diff: prefer the live editor's JSON; fall back to a decoded blob.
  function currentDoc(): PMNode | null {
    if (editor) return editor.getJSON() as PMNode
    if (currentState) return stateToProsemirrorJSON(currentState)
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
      setError('Failed to save version.')
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
      setError('Failed to rename version.')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(v: VersionMeta) {
    if (!window.confirm(`Delete version #${v.docVersionSeq}? This cannot be undone.`)) return
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
      setError('Failed to delete version.')
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
        `Restored from #${res.restoredFrom}. A new version (#${res.newDocVersionSeq}) was created; the document will update shortly.`,
      )
      await refresh()
    } catch (e) {
      if (e instanceof VersionSchemaIncompatibleError || e instanceof VersionSchemaNewerError) {
        setError(
          "This version was saved under an incompatible document format and can't be restored.",
        )
      } else {
        setError('Failed to restore version.')
      }
      setConfirmRestore(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="octo-version-panel">
      <div className="octo-member-row">
        <h3 style={{ flex: 1, margin: 0 }}>Version history</h3>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {mySnapshot && (
        <div className="octo-version-save">
          {snapshotOpen ? (
            <div className="octo-member-row">
              <input
                className="octo-uid"
                placeholder="Version label (optional)"
                value={snapshotLabel}
                onChange={(e) => setSnapshotLabel(e.target.value)}
                autoFocus
              />
              <button type="button" className="octo-tb-btn" disabled={busy} onClick={onCreateSnapshot}>
                Save
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
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="octo-tb-btn" onClick={() => setSnapshotOpen(true)}>
              Save current version
            </button>
          )}
        </div>
      )}

      {notice && <p className="octo-version-notice">{notice}</p>}
      {error && <p className="octo-member-error">{error}</p>}
      {loading && versions.length === 0 && <p className="octo-loading">Loading versions…</p>}
      {!loading && versions.length === 0 && (
        <p className="octo-version-empty">No saved versions yet.</p>
      )}

      <ul className="octo-version-list">
        {versions.map((v) => {
          const isSelected = selected?.docVersionSeq === v.docVersionSeq
          const renameable = mySnapshot && v.kind === 'named'
          return (
            <li
              key={v.docVersionSeq}
              className={`octo-version-row${isSelected ? ' is-selected' : ''}`}
            >
              <div className="octo-version-meta">
                <span className={`octo-version-badge octo-version-badge-${v.kind}`}>
                  {kindBadge(v)}
                </span>
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
                <span
                  className="octo-version-time"
                  title={formatAbsolute(v.createdAt)}
                >
                  {formatRelative(v.createdAt)} · {v.createdBy}
                </span>
              </div>
              <div className="octo-version-actions">
                {renamingSeq === v.docVersionSeq ? (
                  <>
                    <button
                      type="button"
                      className="octo-tb-btn"
                      disabled={busy || renameValue.trim() === ''}
                      onClick={() => onRename(v.docVersionSeq)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="octo-tb-btn"
                      onClick={() => setRenamingSeq(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="octo-tb-btn" onClick={() => onPreview(v)}>
                      Preview
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
                        Rename
                      </button>
                    )}
                    {myRestore && (
                      <button
                        type="button"
                        className="octo-tb-btn"
                        onClick={() => setConfirmRestore(v)}
                      >
                        Restore
                      </button>
                    )}
                    {myRestore && (
                      <button
                        type="button"
                        className="octo-tb-btn"
                        disabled={busy}
                        onClick={() => onDelete(v)}
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {nextCursor != null && (
        <button type="button" className="octo-tb-btn" disabled={loading} onClick={loadMore}>
          Load more
        </button>
      )}

      {confirmRestore && (
        <div className="octo-version-confirm">
          <p>
            Restore version <strong>#{confirmRestore.docVersionSeq}</strong>?
          </p>
          <p className="octo-version-confirm-detail">
            This is non-destructive: the current document is saved as a new version first, then a
            new version is created from the restored content. Nothing is overwritten.
          </p>
          <div className="octo-member-row">
            <button
              type="button"
              className="octo-tb-btn"
              disabled={busy}
              onClick={() => onConfirmRestore(confirmRestore)}
            >
              Restore
            </button>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={busy}
              onClick={() => setConfirmRestore(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selected && (
        <div className="octo-version-detail">
          <div className="octo-member-row">
            <h4 style={{ flex: 1, margin: 0 }}>
              {compare ? 'Compare with current' : 'Preview'} — #{selected.docVersionSeq}
            </h4>
            <button
              type="button"
              className="octo-tb-btn"
              disabled={previewState !== 'ready'}
              onClick={() => setCompare((c) => !c)}
            >
              {compare ? 'Show preview' : 'Compare with current'}
            </button>
          </div>

          {previewState === 'loading' && <p className="octo-loading">Loading preview…</p>}
          {previewState === 'error' && (
            <p className="octo-member-error">Failed to load this version.</p>
          )}

          {previewState === 'ready' && previewJSON && !compare && (
            <VersionPreview docId={docId} content={previewJSON} />
          )}

          {previewState === 'ready' && compare && diff && <DiffView diff={diff} />}
        </div>
      )}
    </section>
  )
}

/** Block-level diff render: added / removed / changed / unchanged rows (feature #4 §1.4). */
function DiffView({ diff }: { diff: DiffEntry[] }) {
  if (diff.length === 1 && diff[0].type === 'too-large') {
    return (
      <p className="octo-version-empty">
        This document is too large to compare here. Preview each version instead.
      </p>
    )
  }
  if (diff.every((d) => d.type === 'unchanged')) {
    return <p className="octo-version-empty">No block-level changes.</p>
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
