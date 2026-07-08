// Version-history panel for spreadsheets — the sheet counterpart of the docs
// VersionPanel. It reuses the version REST layer (versions/api.ts) and time
// formatting (versions/format.ts) UNCHANGED; the only sheet-specific parts are:
//   - preview renders the snapshot's CELLS (a read-only HTML grid) instead of a
//     Tiptap document — the docs panel renders ProseMirror JSON, which for a sheet
//     is empty (the cells live in the 'sheet' Yjs map, returned as `sheetCells`).
//   - compare is a CELL-LEVEL change list (added / changed / removed) against the
//     current live grid, not a text-block diff.
//   - restore just calls the backend, which now reconciles the 'sheet' map onto the
//     live doc (see octo-docs-backend liveRestore.ts); the grid updates via Yjs.
//
// It does NOT modify any docs file, so it won't conflict with ongoing docs work.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { Role } from '../auth/roles.ts'
import { canEdit, canManage } from '../auth/roles.ts'
import { t } from '../octoweb/index.ts'
import { formatRelative, formatAbsolute } from '../versions/format.ts'
import {
  listVersions,
  createNamedVersion,
  getVersionState,
  restoreVersion,
  renameVersion,
  deleteVersion,
  type VersionMeta,
} from '../versions/api.ts'
import type { CollabSheet } from './CollabSheet.ts'

type Cell = { v?: unknown; f?: string; s?: Record<string, unknown> }
type CellMap = Record<string, Cell>

/** 0-based column index → A1 letters (0→A, 26→AA). */
function colToA1(col: number): string {
  let n = col
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

/** Parse a cell key (`${sheetId}!${row}:${col}`) to row/col. */
function parseKey(key: string): { row: number; col: number } | null {
  const rc = key.split('!')[1]
  if (!rc) return null
  const [rs, cs] = rc.split(':')
  const row = Number(rs)
  const col = Number(cs)
  return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null
}

/** Displayable text for a cell value. */
function cellText(cell: Cell | undefined): string {
  if (!cell || cell.v == null || cell.v === '') return ''
  return String(cell.v)
}

/** Read the sheet's current cells from the live Y.Doc (the compare baseline). */
function currentCells(sheet: CollabSheet | null): CellMap {
  const out: CellMap = {}
  if (!sheet) return out
  const ymap = sheet.ydoc.getMap<Cell>('sheet')
  for (const [k, v] of ymap.entries()) out[k] = v
  return out
}

/** A small read-only grid rendering of a cell map (used for the preview). */
function CellGrid({ cells }: { cells: CellMap }) {
  const { rows, cols, byRC } = useMemo(() => {
    let maxR = -1
    let maxC = -1
    const m = new Map<string, Cell>()
    for (const [key, cell] of Object.entries(cells)) {
      const rc = parseKey(key)
      if (!rc) continue
      m.set(`${rc.row}:${rc.col}`, cell)
      if (rc.row > maxR) maxR = rc.row
      if (rc.col > maxC) maxC = rc.col
    }
    // Cap the rendered range so a sparse cell far out doesn't blow up the table.
    return { rows: Math.min(maxR, 199) + 1, cols: Math.min(maxC, 49) + 1, byRC: m }
  }, [cells])

  if (rows <= 0 || cols <= 0) return <p className="octo-comment-empty">{t('docs.sheet.version.emptyGrid')}</p>

  return (
    <div style={{ overflow: 'auto', maxHeight: '52vh', border: '1px solid #ddd' }}>
      <table className="octo-sheet-preview-grid" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thStyle} />
            {Array.from({ length: cols }, (_, c) => (
              <th key={c} style={thStyle}>{colToA1(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              <th style={thStyle}>{r + 1}</th>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c} style={tdStyle} title={byRC.get(`${r}:${c}`)?.f}>
                  {cellText(byRC.get(`${r}:${c}`))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const thStyle: CSSProperties = {
  border: '1px solid #ddd',
  background: '#f5f5f5',
  color: '#333',
  padding: '2px 6px',
  position: 'sticky',
  top: 0,
  whiteSpace: 'nowrap',
}
const tdStyle: CSSProperties = {
  border: '1px solid #eee',
  padding: '2px 6px',
  minWidth: 48,
  maxWidth: 160,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

interface DiffEntry {
  a1: string
  from: string
  to: string
  kind: 'added' | 'changed' | 'removed'
}

/** Cell-level diff between a version's cells (`from`) and the current cells (`to`). */
function diffCells(from: CellMap, to: CellMap): DiffEntry[] {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)])
  const out: DiffEntry[] = []
  for (const key of keys) {
    const rc = parseKey(key)
    if (!rc) continue
    const a = cellText(from[key])
    const b = cellText(to[key])
    if (a === b) continue
    out.push({
      a1: `${colToA1(rc.col)}${rc.row + 1}`,
      from: a,
      to: b,
      kind: a === '' ? 'added' : b === '' ? 'removed' : 'changed',
    })
  }
  // stable-ish order by cell address
  out.sort((x, y) => (x.a1 < y.a1 ? -1 : x.a1 > y.a1 ? 1 : 0))
  return out
}

export function SheetVersionPanel({
  docId,
  role,
  sheet,
  names,
  onClose,
}: {
  docId: string
  role: Role
  sheet: CollabSheet | null
  names?: Map<string, string>
  onClose?: () => void
}) {
  const [items, setItems] = useState<VersionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Inline "save current version" compose row (mirror of the docs VersionPanel): a collapsed
  // "保存当前版本" button expands to a name input + 保存/取消, instead of a native window.prompt.
  const [snapshotOpen, setSnapshotOpen] = useState(false)
  const [snapshotLabel, setSnapshotLabel] = useState('')

  const [preview, setPreview] = useState<{ seq: number; cells: CellMap } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [compare, setCompare] = useState(false)

  const nameOf = (uid: string) => names?.get(uid) || uid

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listVersions(docId, { kind: 'all', limit: 50 })
      setItems(res.items)
    } catch {
      setError(t('docs.sheet.version.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [docId])
  useEffect(() => {
    void refresh()
  }, [refresh])

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
      setError(t('docs.sheet.version.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const onPreview = async (seq: number) => {
    setPreviewLoading(true)
    setCompare(false)
    try {
      const res = (await getVersionState(docId, seq)) as { sheetCells?: CellMap }
      setPreview({ seq, cells: res.sheetCells ?? {} })
    } catch {
      setError(t('docs.sheet.version.previewFailed'))
    } finally {
      setPreviewLoading(false)
    }
  }

  const onRestore = async (seq: number) => {
    if (!window.confirm(t('docs.sheet.version.restoreConfirm'))) return
    setBusy(true)
    try {
      await restoreVersion(docId, seq)
      await refresh()
      setPreview(null)
    } catch {
      setError(t('docs.sheet.version.restoreFailed'))
    } finally {
      setBusy(false)
    }
  }

  const onRename = async (seq: number, cur: string) => {
    const label = window.prompt(t('docs.sheet.version.renamePrompt'), cur)
    if (label === null || label.trim() === '') return
    setBusy(true)
    try {
      await renameVersion(docId, seq, label.trim())
      await refresh()
    } catch {
      setError(t('docs.sheet.version.renameFailed'))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (seq: number) => {
    if (!window.confirm(t('docs.sheet.version.deleteConfirm'))) return
    setBusy(true)
    try {
      await deleteVersion(docId, seq)
      if (preview?.seq === seq) setPreview(null)
      await refresh()
    } catch {
      setError(t('docs.sheet.version.deleteFailed'))
    } finally {
      setBusy(false)
    }
  }

  const diff = useMemo(
    () => (compare && preview ? diffCells(preview.cells, currentCells(sheet)) : null),
    [compare, preview, sheet],
  )

  const kindLabel = (k: VersionMeta['kind']) =>
    k === 'named' ? t('docs.sheet.version.kindNamed') : k === 'restore-marker' ? t('docs.sheet.version.kindRestore') : t('docs.sheet.version.kindAuto')

  return (
    <section className="octo-comment-panel">
      <div className="octo-member-row">
        <h3 style={{ flex: 1, margin: 0 }}>{t('docs.sheet.version.title')}</h3>
        {onClose && (
          <button type="button" className="octo-tb-btn" onClick={onClose}>
            {t('docs.comment.close')}
          </button>
        )}
      </div>

      {/* Save current version — inline compose row (mirror of the docs VersionPanel), replacing the
          old native window.prompt: a collapsed button expands to a name input + 保存/取消. */}
      {canEdit(role) && (
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
              {t('docs.sheet.version.save')}
            </button>
          )}
        </div>
      )}

      {error && <p className="octo-member-error">{error}</p>}

      {preview && (
        <div className="octo-sheet-preview" style={{ marginBottom: 12 }}>
          <div className="octo-comment-actions" style={{ marginBottom: 6 }}>
            <strong style={{ flex: 1 }}>{t('docs.sheet.version.preview')} · #{preview.seq}</strong>
            <button type="button" className="octo-tb-btn" onClick={() => setCompare((c) => !c)}>
              {compare ? t('docs.sheet.version.viewContent') : t('docs.sheet.version.compare')}
            </button>
            <button type="button" className="octo-tb-btn" onClick={() => setPreview(null)}>
              {t('docs.sheet.version.closePreview')}
            </button>
          </div>
          {compare && diff ? (
            diff.length === 0 ? (
              <p className="octo-comment-empty">{t('docs.sheet.version.noDiff')}</p>
            ) : (
              <ul className="octo-sheet-diff-list" style={{ maxHeight: '52vh', overflow: 'auto', margin: 0, padding: 0, listStyle: 'none' }}>
                {diff.map((d) => (
                  <li key={d.a1} style={{ padding: '3px 4px', borderBottom: '1px solid #eee', fontSize: 12 }}>
                    <span style={{ fontWeight: 600, marginRight: 6 }}>{d.a1}</span>
                    <span style={{ color: d.kind === 'added' ? '#16a34a' : d.kind === 'removed' ? '#dc2626' : '#d97706' }}>
                      {d.kind === 'added' ? t('docs.sheet.version.added') : d.kind === 'removed' ? t('docs.sheet.version.removed') : t('docs.sheet.version.changed')}
                    </span>
                    <span style={{ marginLeft: 8, opacity: 0.75 }}>
                      {d.from || t('docs.sheet.version.emptyCell')} → {d.to || t('docs.sheet.version.emptyCell')}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <CellGrid cells={preview.cells} />
          )}
        </div>
      )}

      {loading && items.length === 0 && <p className="octo-loading">{t('docs.sheet.version.loading')}</p>}
      {!loading && items.length === 0 && <p className="octo-comment-empty">{t('docs.sheet.version.empty')}</p>}

      <ul className="octo-comment-list">
        {items.map((v) => (
          <li key={v.docVersionSeq} className={`octo-comment-thread${preview?.seq === v.docVersionSeq ? ' is-selected' : ''}`}>
            <div className="octo-comment-head">
              <span className="octo-comment-quote">{v.label || `#${v.docVersionSeq}`}</span>
              <span className="octo-comment-time" title={formatAbsolute(v.createdAt)}>
                {kindLabel(v.kind)} · {formatRelative(v.createdAt)}
              </span>
            </div>
            <div className="octo-uid" style={{ fontSize: 12, opacity: 0.7 }}>{nameOf(v.createdBy)}</div>
            <div className="octo-comment-actions">
              <button type="button" className="octo-tb-btn" disabled={previewLoading} onClick={() => void onPreview(v.docVersionSeq)}>
                {t('docs.sheet.version.preview')}
              </button>
              {canManage(role) && (
                <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => void onRestore(v.docVersionSeq)}>
                  {t('docs.sheet.version.restore')}
                </button>
              )}
              {canEdit(role) && v.kind === 'named' && (
                <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => void onRename(v.docVersionSeq, v.label)}>
                  {t('docs.sheet.version.rename')}
                </button>
              )}
              {canManage(role) && (
                <button type="button" className="octo-tb-btn" disabled={busy} onClick={() => void onDelete(v.docVersionSeq)}>
                  {t('docs.sheet.version.delete')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
