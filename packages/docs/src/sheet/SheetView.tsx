// React host for a collaborative spreadsheet. Reuses the docs editor's CHROME —
// same CSS classes (octo-doc / octo-doc-header / octo-tb-btn / octo-doc-drawer) and
// the same standalone panels (MemberPanel / InvitePanel / VersionPanel / PresenceBar) —
// so the sheet's top-right controls look IDENTICAL to a document. It imports those
// components as-is: it does NOT modify any existing docs file, so it won't conflict
// with ongoing docs work and inherits their improvements automatically.
//
// Comments and export need per-type implementations (docs comments are anchored to
// ProseMirror text; export differs), so those buttons open a placeholder for now —
// they still render in the same place so the layout matches.

import { useEffect, useRef, useState } from 'react'
import { CollabSheet, type CollabSheetOptions } from './CollabSheet.ts'
import type { ConnState, TerminalState } from '../collab/createCollabEditor.ts'
import { type Role, canManage } from '../auth/roles.ts'
import { MemberPanel } from '../members/MemberPanel.tsx'
import { SheetVersionPanel } from './SheetVersionPanel.tsx'
import { SheetCommentPanel } from './SheetCommentPanel.tsx'
import { useDocComments } from '../comments/useDocComments.ts'
import { pendingSheetImports } from './xlsxImport.ts'
import { PresenceBar } from '../editor/PresenceBar.tsx'
import { useMemberNames } from '../members/useMemberNames.ts'
import * as XLSX from 'xlsx-js-style'
import { getDoc, updateDocTitle, deleteDoc } from '../pages/docsApi.ts'
import { t } from '../octoweb/index.ts'
import '../editor/styles.css'

export type SheetViewProps = Omit<CollabSheetOptions, 'container' | 'onRole' | 'onConnState' | 'onTerminal'> & {
  /** Called after the title is renamed so the docs list can refresh (mirror of EditorShell). */
  onTitleSaved?: (docId: string, title: string) => void
  /** Called after the sheet is deleted so the shell returns to the list + refreshes it. */
  onDeleted?: (docId: string) => void
}

type Panel = 'history' | 'comments' | 'members' | null

/** Decode a sheet comment anchor (base64 of `${sheetId}!${row}:${col}`) to row/col. */
function cellFromAnchor(anchorStart?: string | null): { row: number; col: number } | null {
  if (!anchorStart) return null
  try {
    const rc = atob(anchorStart).split('!')[1]
    if (!rc) return null
    const [rs, cs] = rc.split(':')
    const row = Number(rs)
    const col = Number(cs)
    if (Number.isInteger(row) && Number.isInteger(col)) return { row, col }
  } catch {
    // not a cell anchor — ignore
  }
  return null
}

/** Active cell + its on-screen rect (relative to the sheet container). */
type CellAnchor = {
  row: number
  col: number
  a1: string
  key: string
  left: number
  top: number
  width: number
  height: number
}

/**
 * Inline comment compose bubble anchored below a cell — the sheet counterpart of the doc
 * editor's selection bubble (same "添加评论… / 评论 / 取消" UX). Renders over the grid.
 */
function SheetCommentComposer({
  anchor,
  dark,
  onSubmit,
  onCancel,
}: {
  anchor: CellAnchor
  dark: boolean
  onSubmit: (body: string) => Promise<void>
  onCancel: () => void
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (busy || !body.trim()) return
    setBusy(true)
    try {
      await onSubmit(body.trim())
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="octo-sheet-comment-composer"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: anchor.left,
        top: anchor.top + anchor.height + 4,
        zIndex: 20,
        width: 230,
        padding: 8,
        borderRadius: 6,
        background: dark ? '#2a2a2a' : '#fff',
        border: `1px solid ${dark ? '#444' : '#dadce0'}`,
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>{t('docs.sheet.comment.menu')} {anchor.a1}</div>
      <textarea
        autoFocus
        className="octo-comment-input"
        placeholder={t('docs.sheet.comment.add')}
        value={body}
        rows={3}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
      />
      <div className="octo-comment-compose-actions" style={{ marginTop: 6, display: 'flex', gap: 8 }}>
        <button type="button" className="octo-tb-btn" disabled={busy || !body.trim()} onClick={() => void submit()}>
          {t('docs.sheet.comment.menu')}
        </button>
        <button type="button" className="octo-tb-btn" disabled={busy} onClick={onCancel}>
          {t('docs.comment.cancel')}
        </button>
      </div>
    </div>
  )
}

export function SheetView(props: SheetViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [sheet, setSheet] = useState<CollabSheet | null>(null)
  const [role, setRole] = useState<Role>('reader')
  const [conn, setConn] = useState<ConnState>('connecting')
  const [terminal, setTerminal] = useState<TerminalState>({ kind: 'none' })
  const [panel, setPanel] = useState<Panel>(null)
  const [title, setTitle] = useState('')
  // Track the APP theme (body[theme-mode], set by dmworkbase across web/desktop) with a
  // fallback to the OS preference. The shared .octo-theme CSS only follows prefers-color-scheme,
  // so we theme the sheet chrome ourselves from the app signal to stay consistent.
  const [dark, setDark] = useState(false)

  const { uid, space, folder, doc, docId, disableOfflineCache, onTitleSaved, onDeleted } = props
  const userId = props.user.id
  const names = useMemberNames(space)
  const manage = canManage(role)

  // Comments are owned here (not inside the panel) so the cell markers stay visible
  // even when the panel is closed, and refresh as comments are added/removed.
  const comments = useDocComments(docId)
  const [commentFocus, setCommentFocus] = useState<{ row: number; col: number } | null>(null)
  const [composer, setComposer] = useState<CellAnchor | null>(null)

  // Always paint a corner badge on every commented cell (independent of the panel).
  // Orange = has an open comment, green = resolved (resolved threads only load when the
  // panel's "显示已解决" is on, so a green badge appears once you opt to show them).
  useEffect(() => {
    if (!sheet) return
    const cells = comments.threads
      .map((th) => {
        const c = cellFromAnchor(th.anchorStart)
        return c ? { ...c, resolved: th.resolved } : null
      })
      .filter((c): c is { row: number; col: number; resolved: boolean } => c != null)
    sheet.setCommentedCells(cells)
  }, [sheet, comments.threads])

  // Clicking a cell's comment badge opens the panel focused on that cell's thread.
  useEffect(() => {
    if (!sheet) return
    sheet.setCommentMarkerClickHandler((row, col) => {
      setPanel('comments')
      setCommentFocus({ row, col })
      sheet.focusCell(row, col)
    })
    return () => sheet.setCommentMarkerClickHandler(null)
  }, [sheet])

  // If this sheet was created via "从 Excel 导入", drain the pending import into the
  // freshly-connected book (once). We import FIRST and only drop the pending entry after a
  // successful apply — the old order (delete → import) lost the parsed data with no retry
  // and no error if importCells returned false or threw. Keeping it on failure lets a reopen
  // retry instead of silently dropping the user's spreadsheet.
  useEffect(() => {
    if (!sheet) return
    const imp = pendingSheetImports.get(docId)
    if (!imp) return
    let applied = false
    try {
      applied = sheet.importCells(imp.matrix, imp.merges)
    } catch (err) {
      console.error('[docs] sheet import threw — keeping pending import for a retry on reopen', err)
    }
    if (applied) pendingSheetImports.delete(docId)
    else console.warn('[docs] sheet import did not apply — pending import kept, will retry on reopen')
  }, [sheet, docId])

  // Right-click "评论" menu item: open an inline compose bubble next to the cell (the
  // sheet counterpart of the doc editor's selection bubble), instead of the side panel.
  useEffect(() => {
    if (!sheet) return
    sheet.setCommentMenuHandler(() => {
      const a = sheet.getActiveCellAnchor()
      if (a) setComposer(a)
    })
    return () => sheet.setCommentMenuHandler(null)
  }, [sheet])

  // Load the real title so it's editable (docs have an inline DocTitle; the sheet
  // reuses the same rename REST endpoint).
  useEffect(() => {
    getDoc(docId)
      .then((m) => setTitle(m.title || ''))
      .catch(() => {})
  }, [docId])

  // Push the resolved display name into presence once the member-name lookup returns
  // (the sheet is created before names resolve, so avatar/cursor start with the uid).
  useEffect(() => {
    const name = names.get(userId)
    if (sheet && name) sheet.updatePresenceName(name)
  }, [sheet, names, userId])

  // Follow the app theme: react to body[theme-mode] changes and OS preference.
  useEffect(() => {
    const detect = () => {
      const m = document.body.getAttribute('theme-mode')
      return m ? m === 'dark' : !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
    }
    setDark(detect())
    const mo = new MutationObserver(() => setDark(detect()))
    mo.observe(document.body, { attributes: true, attributeFilter: ['theme-mode'] })
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onMq = () => setDark(detect())
    mq?.addEventListener?.('change', onMq)
    return () => {
      mo.disconnect()
      mq?.removeEventListener?.('change', onMq)
    }
  }, [])

  const saveTitle = () => {
    if (!manage) return
    const next = title.trim()
    void updateDocTitle(docId, next || t('docs.state.untitled'))
      .then(() => onTitleSaved?.(docId, next))
      .catch(() => {})
  }

  // Delete the sheet (soft delete, owner/admin) — same logic as the docs "删除文档"
  // entry, so the right-click 移除 and this header button behave identically.
  const removeSheet = async () => {
    if (!manage) return
    if (!window.confirm(t('docs.sheet.deleteConfirm'))) return
    try {
      await deleteDoc(docId)
      onDeleted?.(docId)
    } catch {
      // ignore — surfaced elsewhere; keep the sheet open on failure
    }
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined

    // Own child host per CollabSheet — React 18 StrictMode double-invokes effects in dev;
    // isolating each instance's Univer into its own div (removed on cleanup) keeps the
    // throwaway instance's dispose() from tearing down the surviving instance's DOM.
    const host = document.createElement('div')
    host.style.width = '100%'
    host.style.height = '100%'
    el.appendChild(host)

    let created: CollabSheet | null = null
    let cancelled = false

    void CollabSheet.create({
      ...props,
      container: host,
      onRole: setRole,
      onConnState: setConn,
      onTerminal: setTerminal,
    })
      .then((s) => {
        if (cancelled) {
          s.destroyAll()
          return
        }
        created = s
        setSheet(s)
      })
      .catch((e) => {
        console.error('[sheet] CollabSheet.create failed', docId, e)
      })

    return () => {
      cancelled = true
      created?.destroyAll()
      created = null
      setSheet(null)
      host.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, space, folder, doc, docId, userId, disableOfflineCache])

  if (terminal.kind !== 'none') {
    return <div className="octo-sheet-terminal" data-kind={terminal.kind} />
  }

  const tb = (p: Panel) => (panel === p ? 'octo-tb-btn is-active' : 'octo-tb-btn')
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p))
  const closePanel = () => setPanel(null)

  // Export the sheet to .xlsx via the SheetJS (xlsx) library, built from the shared Y.Map.
  const exportXlsx = () => {
    if (!sheet) return
    const ymap = sheet.ydoc.getMap<{ v?: unknown; f?: string; s?: Record<string, unknown> }>('sheet')
    let maxR = 0
    let maxC = 0
    const cells = new Map<string, { v?: unknown; f?: string; s?: Record<string, unknown> }>()
    for (const [key, cell] of ymap.entries()) {
      const rc = key.split('!')[1]
      if (!rc) continue
      const [rs, cs] = rc.split(':')
      const r = Number(rs)
      const c = Number(cs)
      if (!Number.isInteger(r) || !Number.isInteger(c)) continue
      cells.set(`${r}:${c}`, cell)
      if (r > maxR) maxR = r
      if (c > maxC) maxC = c
    }
    // Normalize a Univer color (#rrggbb / rrggbb / rgb(r,g,b)) to the 6-hex SheetJS wants.
    const toHex = (rgb?: string): string | undefined => {
      if (!rgb) return undefined
      const s = rgb.trim()
      const m = s.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
      if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()
      const hex = s.replace('#', '')
      return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : /^[0-9a-fA-F]{8}$/.test(hex) ? hex.slice(2).toUpperCase() : undefined
    }
    // Build the worksheet SPARSELY from populated cells only. The previous approach filled a
    // dense 0..maxR × 0..maxC grid (plus two more dense loops for style/formula), so a single
    // far cell — e.g. a remote XFD1048576 — allocated billions of slots and OOM'd every
    // collaborator's tab (DoS). A .xlsx is sparse by nature: write only the cells that exist
    // and declare the used range via '!ref'. Cost is now O(populated cells), not O(maxR×maxC).
    const ws: XLSX.WorkSheet = {}
    for (const [rc, cell] of cells) {
      const [rs, cs] = rc.split(':')
      const out: { t: 'n' | 'b' | 's'; v?: unknown; f?: string; s?: Record<string, unknown> } = { t: 's', v: '' }
      const v = cell.v
      if (typeof v === 'number') {
        out.t = 'n'
        out.v = v
      } else if (typeof v === 'boolean') {
        out.t = 'b'
        out.v = v
      } else if (v != null) {
        out.t = 's'
        out.v = v
      }
      // Preserve formula (Univer stores it WITH a leading '='; SheetJS wants it WITHOUT). Its
      // `v` stays the last cached result so non-recalc viewers still show a number.
      if (cell.f) out.f = cell.f.startsWith('=') ? cell.f.slice(1) : cell.f
      // Map the synced Univer style (font / color / size / bg / align / number-format).
      if (cell.s) {
        const s = cell.s as {
          bl?: number; it?: number; ul?: { s?: number }; st?: { s?: number }
          fs?: number; ff?: string; cl?: { rgb?: string }; bg?: { rgb?: string }; ht?: number; vt?: number
          n?: { pattern?: string }
        }
        const fontColor = toHex(s.cl?.rgb)
        const bgColor = toHex(s.bg?.rgb)
        out.s = {
          font: {
            bold: !!s.bl,
            italic: !!s.it,
            underline: !!s.ul?.s,
            strike: !!s.st?.s,
            ...(s.fs ? { sz: s.fs } : {}),
            ...(s.ff ? { name: s.ff } : {}),
            ...(fontColor ? { color: { rgb: fontColor } } : {}),
          },
          ...(bgColor ? { fill: { patternType: 'solid', fgColor: { rgb: bgColor } } } : {}),
          alignment: {
            horizontal: s.ht === 2 ? 'center' : s.ht === 3 ? 'right' : s.ht === 1 ? 'left' : undefined,
            vertical: s.vt === 1 ? 'top' : s.vt === 3 ? 'bottom' : undefined,
          },
        }
        // Carry the number-format pattern (e.g. dates stored as `s.n.pattern = 'yyyy/m/d'`)
        // into SheetJS `z`, otherwise a date serial exports as a bare integer and the
        // reopened file shows `45292` instead of `2024/1/1`. See xlsxImport.ts (import side).
        if (s.n?.pattern) (out.s as { z?: string }).z = s.n.pattern
      }
      ws[XLSX.utils.encode_cell({ r: Number(rs), c: Number(cs) })] = out as unknown as XLSX.CellObject
    }
    // Declare the used range. A large range STRING is harmless (unlike a dense array).
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } })
    // Merged cells: read the shared merge map (keys `sr:sc:er:ec`) → SheetJS `!merges`.
    // Import captures merges, so without this the round-trip flattens merged title bars.
    const mergeMap = sheet.ydoc.getMap<boolean>('sheetMerges')
    const merges: XLSX.Range[] = []
    for (const [key, on] of mergeMap.entries()) {
      if (!on) continue
      const parts = key.split(':').map((n) => Number(n))
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) continue
      const [sr, sc, er, ec] = parts
      merges.push({ s: { r: sr, c: sc }, e: { r: er, c: ec } })
    }
    if (merges.length) ws['!merges'] = merges
    // Column widths / row heights: read the shared dims map (keys `c<idx>`/`r<idx>`) →
    // SheetJS `!cols` (wpx) / `!rows` (hpx). Import applies these, so exporting without
    // them loses every custom width/height on the round-trip.
    const dimMap = sheet.ydoc.getMap<number>('sheetDims')
    const cols: XLSX.ColInfo[] = []
    const rows: XLSX.RowInfo[] = []
    for (const [key, size] of dimMap.entries()) {
      const idx = Number(key.slice(1))
      if (!Number.isInteger(idx) || typeof size !== 'number' || size <= 0) continue
      if (key.startsWith('c')) cols[idx] = { wpx: size }
      else if (key.startsWith('r')) rows[idx] = { hpx: size }
    }
    if (cols.length) ws['!cols'] = cols
    if (rows.length) ws['!rows'] = rows
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    XLSX.writeFile(wb, `${title || docId}.xlsx`)
  }

  return (
    <div className="octo-doc octo-doc--editor octo-theme" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: dark ? '#1f1f1f' : undefined, color: dark ? '#e8eaed' : undefined }}>
      <header className="octo-doc-header" style={dark ? { background: '#1f1f1f', color: '#e8eaed', borderBottom: '1px solid #333' } : undefined}>
        <input
          className="octo-doc-title"
          value={title}
          placeholder={t('docs.state.untitled')}
          disabled={!manage}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          style={{ border: 'none', background: 'transparent', outline: 'none', color: 'inherit', flex: '0 1 auto', minWidth: 0, maxWidth: '55%' }}
        />
        <div className="octo-doc-header-right">
          {sheet && <PresenceBar provider={sheet.provider} connState={conn} synced={conn === 'connected'} />}
          <button type="button" className={tb('history')} aria-pressed={panel === 'history'} onClick={() => toggle('history')}>
            🕐 {t('docs.toolbar.history')}
          </button>
          <button type="button" className={tb('comments')} aria-pressed={panel === 'comments'} onClick={() => toggle('comments')}>
            💬 {t('docs.toolbar.comments')}
          </button>
          <button type="button" className="octo-tb-btn" title={t('docs.sheet.exportExcel')} disabled={!sheet} onClick={exportXlsx}>
            ⬇ {t('docs.sheet.exportExcel')}
          </button>
          {manage && (
            <button type="button" className={tb('members')} aria-pressed={panel === 'members'} onClick={() => toggle('members')}>
              {t('docs.toolbar.members')}
            </button>
          )}
          {manage && (
            <button type="button" className="octo-tb-btn octo-doc-delete-btn" onClick={() => void removeSheet()}>
              🗑 {t('docs.sheet.deleteFile')}
            </button>
          )}
        </div>
      </header>

      <div style={{ flex: '1 1 auto', position: 'relative', minHeight: 0 }}>
        <div ref={containerRef} className="octo-sheet-container" style={{ position: 'absolute', inset: 0 }} />
        {composer && (
          <SheetCommentComposer
            anchor={composer}
            dark={dark}
            onCancel={() => setComposer(null)}
            onSubmit={async (body) => {
              const enc = btoa(composer.key)
              await comments.createRoot({ body, anchorStart: enc, anchorEnd: enc, anchorText: composer.a1 })
              setComposer(null)
            }}
          />
        )}
        {panel && (
          <aside className="octo-doc-drawer" role="complementary">
            {panel === 'history' && (
              <SheetVersionPanel docId={docId} role={role} sheet={sheet} names={names} onClose={closePanel} />
            )}
            {panel === 'members' && manage && (
              <MemberPanel docId={docId} role={role} space={space} ownerId={uid} onClose={closePanel} />
            )}
            {panel === 'comments' && (
              <SheetCommentPanel
                docId={docId}
                sheet={sheet}
                role={role}
                names={names}
                comments={comments}
                focusCell={commentFocus}
                onClose={closePanel}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
