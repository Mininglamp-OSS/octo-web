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
import { SheetCommentPanel, parseCell as parseCommentAnchor } from './SheetCommentPanel.tsx'
import { useDocComments } from '../comments/useDocComments.ts'
import { pendingSheetImports } from './xlsxImport.ts'
import { buildSheetDims, buildSheetMerges, excelSheetName } from './sheetExport.ts'
import { PresenceBar } from '../editor/PresenceBar.tsx'
import { useMemberNames } from '../members/useMemberNames.ts'
import * as XLSX from 'xlsx-js-style'
import { getDoc, getUserName, updateDocTitle } from '../pages/docsApi.ts'
import { startDocForward } from '../forward/startDocForward.ts'
import {
  DocMoreMenu,
  OpenNewPageIcon,
  HistoryIcon,
  ExportIcon,
  DeleteIcon,
  type DocMoreMenuItem,
} from '../editor/DocMoreMenu.tsx'
import { ConfirmModal } from '../editor/ConfirmModal.tsx'
import { useDocDelete } from '../editor/useDocDelete.ts'
import { t, getCurrentUid, canForwardToChat } from '../octoweb/index.ts'
import '../editor/styles.css'

export type SheetViewProps = Omit<CollabSheetOptions, 'container' | 'onRole' | 'onConnState' | 'onTerminal'> & {
  /** Called after the title is renamed so the docs list can refresh (mirror of EditorShell). */
  onTitleSaved?: (docId: string, title: string) => void
  /** Called after the sheet is deleted so the shell returns to the list + refreshes it. */
  onDeleted?: (docId: string) => void
  /**
   * "Open in new page" handler (in-shell only). When provided, the header's ≡ "more" menu shows an
   * "Open in new page" row that opens the shareable standalone `/d/:docId` link — mirror of
   * EditorShell. Omitted on the standalone page itself, so the row simply doesn't render there.
   */
  onOpenInNewPage?: () => void
  /**
   * Extra rows prepended to the TOP of the ≡ "more" menu (mirror of EditorShell). The standalone
   * page uses this to pin its "Copy link" action as the first menu item.
   */
  moreMenuLeadItems?: DocMoreMenuItem[]
  /**
   * Resolve the creator name from the NICKNAME only, never the verified real_name (mirror of
   * EditorShell). Set on the externally shareable standalone surface to avoid leaking a legal name.
   */
  creatorNicknameOnly?: boolean
}

type Panel = 'history' | 'comments' | 'members' | null

// Sheet comment anchors are decoded by SheetCommentPanel.parseCell (single source of truth),
// which also normalizes the legacy V1 anchor sheet id (`octo-sheet-1`) to logical `default`
// (P1-2). SheetView reuses it so comment BADGES/markers resolve legacy anchors identically to
// the panel highlight/focus path — previously a duplicated local decoder here skipped that
// normalization and made every V1 comment badge vanish under V2.

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
  // Creator + creation timestamp for the ≡ "more" menu head (mirror of EditorShell), so the
  // sheet's collapsed menu shows the same creator/created-on line a document does.
  const [ownerId, setOwnerId] = useState<string | undefined>(undefined)
  const [createdAt, setCreatedAt] = useState<string | undefined>(undefined)
  const [creatorName, setCreatorName] = useState<string | undefined>(undefined)
  // Track the APP theme (body[theme-mode], set by dmworkbase across web/desktop) with a
  // fallback to the OS preference. The shared .octo-theme CSS only follows prefers-color-scheme,
  // so we theme the sheet chrome ourselves from the app signal to stay consistent.
  const [dark, setDark] = useState(false)

  const { uid, space, folder, doc, docId, disableOfflineCache, onTitleSaved, onDeleted, onOpenInNewPage, moreMenuLeadItems, creatorNicknameOnly } = props
  const userId = props.user.id
  const names = useMemberNames(space)
  const manage = canManage(role)

  // Comments are owned here (not inside the panel) so the cell markers stay visible
  // even when the panel is closed, and refresh as comments are added/removed.
  const comments = useDocComments(docId)
  const [commentFocus, setCommentFocus] = useState<{ row: number; col: number; sheetId: string } | null>(null)
  const [composer, setComposer] = useState<CellAnchor | null>(null)

  // Always paint a corner badge on every commented cell (independent of the panel).
  // Orange = has an open comment, green = resolved (resolved threads only load when the
  // panel's "显示已解决" is on, so a green badge appears once you opt to show them).
  useEffect(() => {
    if (!sheet) return
    const cells = comments.threads
      .map((th) => {
        const c = parseCommentAnchor(th.anchorStart)
        return c ? { ...c, resolved: th.resolved } : null
      })
      .filter((c): c is { row: number; col: number; sheetId: string; resolved: boolean } => c != null)
    sheet.setCommentedCells(cells)
  }, [sheet, comments.threads])

  // Clicking a cell's comment badge opens the panel focused on that cell's thread.
  useEffect(() => {
    if (!sheet) return
    sheet.setCommentMarkerClickHandler((row, col, sheetId) => {
      setPanel('comments')
      setCommentFocus({ row, col, sheetId })
      sheet.focusCell(row, col, sheetId)
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
      applied = sheet.importCells(imp.sheets)
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
  // reuses the same rename REST endpoint). Also lift ownerId + createdAt for the ≡ menu head.
  useEffect(() => {
    getDoc(docId)
      .then((m) => {
        setTitle(m.title || '')
        if (typeof m.ownerId === 'string' && m.ownerId) setOwnerId(m.ownerId)
        if (typeof m.createdAt === 'string' && m.createdAt) setCreatedAt(m.createdAt)
      })
      .catch(() => {})
  }, [docId])

  // Resolve the creator's display name for the ≡ menu head: first from the already-loaded
  // space-member map (free), then GET /users/:uid. Resilient — any failure leaves it undefined
  // and the menu falls back to a short uid, matching EditorShell's in-shell behavior. On the
  // externally shared standalone surface (creatorNicknameOnly) skip the member-map primary source
  // and force nickname-only, so a link holder never sees the creator's verified legal name.
  useEffect(() => {
    if (!ownerId) return
    if (!creatorNicknameOnly) {
      const fromMembers = names.get(ownerId)
      if (fromMembers && fromMembers !== ownerId) {
        setCreatorName(fromMembers)
        return
      }
    }
    let cancelled = false
    getUserName(ownerId, { preferRealName: !creatorNicknameOnly })
      .then((name) => {
        if (!cancelled && name) setCreatorName(name)
      })
      .catch(() => {
        /* keep the uid fallback */
      })
    return () => {
      cancelled = true
    }
  }, [ownerId, names, creatorNicknameOnly])

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

  // Delete the sheet (soft delete, owner/admin) — reuses the docs delete hook + shared centered
  // ConfirmModal, so a sheet delete and a document delete pop the SAME dialog in the middle of the
  // screen (replacing the old native window.confirm). deleteDoc works for a sheet doc unchanged.
  const del = useDocDelete(docId, onDeleted)

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

  // Export the workbook to .xlsx via SheetJS, built from the shared Y.Maps. MULTI-SHEET:
  // one output worksheet per logical sheet in the 'sheetList' registry (ordered), each with
  // its OWN cells / merges / dims — all keyed by that sheet's logical id. A pre-multi-sheet
  // doc (empty registry) falls back to a single 'default' sheet (its keys are `default!…`).
  const exportXlsx = () => {
    if (!sheet) return
    const cellMap = sheet.ydoc.getMap<{ v?: unknown; f?: string; s?: Record<string, unknown> }>('sheet')
    const mergeMap = sheet.ydoc.getMap<boolean>('sheetMerges')
    const dimMap = sheet.ydoc.getMap<number>('sheetDims')
    const listMap = sheet.ydoc.getMap<{ name: string; order: number }>('sheetList')

    // Normalize a Univer color (#rrggbb / rrggbb / rgb(r,g,b)) to the 6-hex SheetJS wants.
    const toHex = (rgb?: string): string | undefined => {
      if (!rgb) return undefined
      const s = rgb.trim()
      const m = s.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
      if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase()
      const hex = s.replace('#', '')
      return /^[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : /^[0-9a-fA-F]{8}$/.test(hex) ? hex.slice(2).toUpperCase() : undefined
    }

    // Univer BorderStyleTypes (numeric) → xlsx-js-style border style name. Inverse of
    // xlsxImport's BORDER_STYLE map, so a border imported from .xlsx survives re-export.
    const XLSX_BORDER_STYLE: Record<number, string> = {
      1: 'thin', 2: 'hair', 3: 'dotted', 4: 'dashed', 5: 'dashDot', 6: 'dashDotDot',
      7: 'double', 8: 'medium', 9: 'mediumDashed', 10: 'mediumDashDot', 11: 'mediumDashDotDot',
      12: 'slantDashDot', 13: 'thick',
    }
    /** Univer `bd` { t/b/l/r:{ s, cl:{rgb} } } → xlsx-js-style `border` { top/bottom/left/right }. */
    const univerBdToXlsx = (
      bd: Record<string, { s?: number; cl?: { rgb?: string } } | undefined> | undefined,
      hex: (rgb?: string) => string | undefined,
    ): Record<string, { style: string; color: { rgb: string } }> | undefined => {
      if (!bd) return undefined
      const edges: Array<[string, string]> = [['t', 'top'], ['b', 'bottom'], ['l', 'left'], ['r', 'right']]
      const out: Record<string, { style: string; color: { rgb: string } }> = {}
      for (const [k, name] of edges) {
        const e = bd[k]
        if (!e || e.s == null) continue
        const style = XLSX_BORDER_STYLE[e.s] ?? 'thin'
        out[name] = { style, color: { rgb: hex(e.cl?.rgb) ?? '000000' } }
      }
      return Object.keys(out).length > 0 ? out : undefined
    }

    // Build one SheetJS worksheet from all Y.Map data prefixed by this sheet's logical id.
    const buildWs = (logicalId: string): XLSX.WorkSheet => {
      let maxR = 0
      let maxC = 0
      const cells = new Map<string, { v?: unknown; f?: string; s?: Record<string, unknown> }>()
      const cellPrefix = `${logicalId}!`
      for (const [key, cell] of cellMap.entries()) {
        if (!key.startsWith(cellPrefix)) continue
        const rc = key.slice(cellPrefix.length)
        const [rs, cs] = rc.split(':')
        const r = Number(rs)
        const c = Number(cs)
        if (!Number.isInteger(r) || !Number.isInteger(c)) continue
        cells.set(`${r}:${c}`, cell)
        if (r > maxR) maxR = r
        if (c > maxC) maxC = c
      }
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
        if (cell.f) out.f = cell.f.startsWith('=') ? cell.f.slice(1) : cell.f
        if (cell.s) {
          const s = cell.s as {
            bl?: number; it?: number; ul?: { s?: number }; st?: { s?: number }
            fs?: number; ff?: string; cl?: { rgb?: string }; bg?: { rgb?: string }; ht?: number; vt?: number
            n?: { pattern?: string }
            bd?: Record<string, { s?: number; cl?: { rgb?: string } } | undefined>
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
          if (s.n?.pattern) (out.s as { z?: string }).z = s.n.pattern
          // Borders: reverse of xlsxImport's `bd` mapping. Univer stores per-edge
          // { s: BorderStyleType, cl: { rgb } }; xlsx-js-style wants { style, color: { rgb } }.
          // Emitting this closes the import→export round-trip that previously dropped all borders.
          const border = univerBdToXlsx(s.bd, toHex)
          if (border) (out.s as { border?: unknown }).border = border
        }
        ws[XLSX.utils.encode_cell({ r: Number(rs), c: Number(cs) })] = out as unknown as XLSX.CellObject
      }
      ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } })
      // Merges: delegated to buildSheetMerges (sheetExport.ts). V2 keys are `${logicalId}:sr:sc:er:ec`;
      // for the legacy 'default' sheet, bare V1 keys (`sr:sc:er:ec`, no prefix) are added unless a
      // prefixed twin already covers the range (P1-1). Legacy docs wrote dim/merge keys UNPREFIXED
      // and never migrated them; the binding reads them as 'default' on open, so export mirrors that.
      const merges = buildSheetMerges(logicalId, mergeMap.entries() as Iterable<[string, boolean]>)
      if (merges.length) ws['!merges'] = merges
      // Column widths / row heights + merges: delegated to buildSheetDims/buildSheetMerges
      // (sheetExport.ts) so the legacy bare-key handling (P1-1) is unit-testable. Prefixed (V2)
      // values take priority; for the legacy 'default' sheet, bare V1 keys fill gaps / add uncovered
      // merges. Mirrors the binding's open-time read so a legacy doc round-trips its dims/merges.
      const { cols, rows } = buildSheetDims(logicalId, dimMap.entries() as Iterable<[string, number]>)
      if (cols.length) ws['!cols'] = cols
      if (rows.length) ws['!rows'] = rows
      return ws
    }

    // Sheet order from the registry; fall back to one 'default' sheet for legacy docs.
    let metas = [...listMap.entries()]
      .map(([id, m]) => ({ id, name: m.name, order: m.order }))
      .sort((a, b) => a.order - b.order)
    if (metas.length === 0) metas = [{ id: 'default', name: 'Sheet1', order: 0 }]

    const wb = XLSX.utils.book_new()
    const used = new Set<string>()
    let appended = 0
    for (const meta of metas) {
      // Excel-legal, unique name for this sheet (rules + `(n)` collision suffix, ≤31 chars).
      // Extracted to sheetExport.excelSheetName so the P2 slice-overflow fix is unit-testable.
      const n = excelSheetName(meta.name, used)
      // Guard each sheet: a name Univer allowed but XLSX rejects must not abort the ENTIRE export
      // (P2 — exportXlsx had no try/catch, so one bad sheet lost every sheet). Skip the offender.
      try {
        XLSX.utils.book_append_sheet(wb, buildWs(meta.id), n)
        appended++
      } catch {
        // Malformed sheet name/content — drop this one sheet, keep exporting the rest.
      }
    }
    if (appended === 0) return
    XLSX.writeFile(wb, `${title || docId}.xlsx`)
  }

  // "Forward to chat" (mirror of EditorShell, feature #511): reader+ entry. Gated on canForward so
  // it never renders as a silent no-op where the host lacks the conversation-select surface (the
  // standalone /d/:docId page). The forwarded link points at /d/:docId, which now renders the sheet.
  const canForward = canForwardToChat()
  const onForwardToChat = () => {
    if (!role) return
    startDocForward({
      docId,
      title,
      role,
      currentUid: getCurrentUid(),
      ownerId,
      space,
      folder,
    })
  }

  // ≡ "more" menu (mirror of EditorShell): low-frequency actions collapse behind the hamburger, with
  // delete pinned last as the destructive row (manage only). Order: [caller lead rows] → open-in-new-
  // page → history → export. Keeps 评论 / 转发到聊天 / 成员 inline so the chrome matches a document.
  const moreItems: DocMoreMenuItem[] = []
  if (moreMenuLeadItems?.length) moreItems.push(...moreMenuLeadItems)
  if (onOpenInNewPage) {
    moreItems.push({
      key: 'open-new-page',
      label: t('docs.standalone.openInNewPage'),
      icon: OpenNewPageIcon,
      onClick: onOpenInNewPage,
    })
  }
  moreItems.push(
    {
      key: 'history',
      label: t('docs.toolbar.history'),
      icon: HistoryIcon,
      onClick: () => toggle('history'),
    },
    {
      key: 'export',
      label: t('docs.sheet.exportExcel'),
      icon: ExportIcon,
      disabled: !sheet,
      onClick: exportXlsx,
    },
  )
  const deleteItem: DocMoreMenuItem | undefined = manage
    ? {
        key: 'delete',
        label: t('docs.sheet.deleteFile'),
        icon: DeleteIcon,
        danger: true,
        onClick: del.requestDelete,
      }
    : undefined
  // Creator name with fallback: resolved name → short uid → placeholder. Never blank, never crashes.
  const creatorDisplay =
    creatorName || (ownerId ? ownerId.slice(0, 8) : t('docs.moreMenu.unknownCreator'))

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
          <button type="button" className={tb('comments')} aria-pressed={panel === 'comments'} onClick={() => toggle('comments')}>
            💬 {t('docs.toolbar.comments')}
          </button>
          {/* Forward to chat (mirror of EditorShell) — reader+; gated on canForward so it never
              renders as a silent no-op on the standalone page where the host surface is absent. */}
          {role && canForward && (
            <button
              type="button"
              className="octo-tb-btn octo-doc-forward-btn"
              title={t('docs.forward.entry')}
              onClick={onForwardToChat}
            >
              ⤴ {t('docs.forward.entry')}
            </button>
          )}
          {manage && (
            <button type="button" className={tb('members')} aria-pressed={panel === 'members'} onClick={() => toggle('members')}>
              {t('docs.toolbar.members')}
            </button>
          )}
          {/* Low-frequency actions (version history / export / delete) collapse into a single ≡
              "more" menu pinned to the far right, with a creator + created-on head — matching a doc. */}
          <DocMoreMenu
            creatorName={creatorDisplay}
            createdAt={createdAt}
            items={moreItems}
            dangerItem={deleteItem}
          />
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
        {(panel === 'history' || panel === 'comments') && (
          <aside className="octo-doc-drawer" role="complementary">
            {panel === 'history' && (
              <SheetVersionPanel docId={docId} role={role} sheet={sheet} names={names} onClose={closePanel} />
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

      {/* Manage members opens a CENTERED modal (same as the document editor), not a right-side
          drawer — history + comments stay in the drawer above. */}
      {panel === 'members' && manage && (
        <div className="octo-modal-overlay" role="presentation" onMouseDown={closePanel}>
          <div
            className="octo-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t('docs.member.manage')}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <MemberPanel docId={docId} role={role} space={space} ownerId={uid} onClose={closePanel} />
          </div>
        </div>
      )}

      {/* Delete confirm — the shared centered modal, identical to the document's delete dialog. */}
      <ConfirmModal
        open={del.confirming}
        title={t('docs.sheet.deleteConfirmTitle')}
        message={t('docs.sheet.deleteConfirm')}
        confirmLabel={t('docs.doc.delete')}
        cancelLabel={t('docs.doc.deleteCancel')}
        danger
        busy={del.deleting}
        error={del.error}
        onConfirm={() => void del.confirm()}
        onCancel={del.cancel}
      />
    </div>
  )
}
