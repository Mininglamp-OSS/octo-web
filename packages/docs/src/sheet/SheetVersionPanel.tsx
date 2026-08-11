// Sheet version-history panel — now a THIN ADAPTER over the unified <VersionHistoryPanel> shell
// (XIN-842, following the doc adapter XIN-840). The shell owns everything shared across the doc /
// sheet / board ends: the single mixed list with filter tabs (all / manual / auto) + counts +
// load-more, save / rename / delete / restore, the in-panel restore confirm box, the unified race
// guard, and the centered preview / diff modal (Esc / overlay-close / focus). This adapter injects
// only the sheet-specific pieces:
//   - loadPreviewState → GET /versions/:seq/state, reading the snapshot's `sheetCells` (the cells
//     live in the 'sheet' Yjs map; the shared PM-JSON `doc` is empty for a spreadsheet),
//   - renderPreview    → a read-only HTML <CellGrid> of the snapshot cells,
//   - renderDiff       → a CELL-LEVEL change list (added / changed / removed) against the current
//     live grid — reusing the existing diffCells + the octo-sheet-diff-list markup,
//   - getCurrent       → the sheet's current cells read from the live Y.Doc (read-only).
//
// Restore stays forward / non-destructive: the backend reconciles the 'sheet' map onto the live doc
// (see octo-docs-backend liveRestore.ts) and the grid updates via Yjs — this panel never mutates the
// sheet. The sheet-specific pure helpers (CellGrid / diffCells / colToA1 / parseKey / currentCells)
// are preserved unchanged; only the panel chrome moved into the shell.

import { useMemo, type CSSProperties } from 'react'
import type { Role } from '../auth/roles.ts'
import { t } from '../octoweb/index.ts'
import { getVersionState } from '../versions/api.ts'
import type { BotDiffHint } from '../versions/botEditForThread.ts'
import { VersionHistoryPanel } from '../versions/VersionHistoryPanel.tsx'
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

/** The sheet's compare view: a cell-level change list against the current live grid. */
function SheetDiffList({ from, to }: { from: CellMap; to: CellMap }) {
  const diff = useMemo(() => diffCells(from, to), [from, to])
  if (diff.length === 0) return <p className="octo-comment-empty">{t('docs.sheet.version.noDiff')}</p>
  return (
    // 颜色和类名走 CSS,不再内联写死。原来三个 kind 是硬编码 hex:
    //   added #16a34a / removed #dc2626 / changed **#d97706**(amber-600)
    // 「修改」被涂成黄褐色 —— 用户实测报「那块儿颜色是黄色的,不是应该绿色或红色吗」。
    // 而且三个都不跟主题走、跟文档侧的 DiffView 也不是一套色(那边是 --wk-color-success
    // #41cd59 / --wk-color-error #f54a45)。同一个产品里「改动」的颜色语言必须一致。
    // 「修改」归到红+绿的组合语义(旧值 → 新值),用中性次要色标签 + 两侧值分别红/绿,
    // 而不是自造第三种颜色。
    <ul className="octo-sheet-diff-list">
      {diff.map((d) => (
        <li key={d.a1} className={`octo-sheet-diff-row is-${d.kind}`}>
          <span className="octo-sheet-diff-cell">{d.a1}</span>
          <span className="octo-sheet-diff-kind">
            {d.kind === 'added' ? t('docs.sheet.version.added') : d.kind === 'removed' ? t('docs.sheet.version.removed') : t('docs.sheet.version.changed')}
          </span>
          <span className="octo-sheet-diff-values">
            <span className="octo-sheet-diff-before">{d.from || t('docs.sheet.version.emptyCell')}</span>
            {' → '}
            <span className="octo-sheet-diff-after">{d.to || t('docs.sheet.version.emptyCell')}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export function SheetVersionPanel({
  docId,
  role,
  sheet,
  names,
  onClose,
  botDiffHint,
}: {
  docId: string
  role: Role
  /** Live sheet — read-only here; the "current" side of a diff, read from its Y.Doc. */
  sheet: CollabSheet | null
  names?: Map<string, string>
  onClose?: () => void
  /** 见 VersionHistoryPanel 的同名 prop:从评论卡片跳过来时用它直接打开对应 Diff。 */
  botDiffHint?: BotDiffHint | null
}) {
  return (
    <VersionHistoryPanel<CellMap, CellMap>
      botDiffHint={botDiffHint}
      docId={docId}
      role={role}
      names={names}
      onClose={onClose}
      loadPreviewState={(seq, signal) =>
        getVersionState(docId, seq, signal).then((r) => (r as { sheetCells?: CellMap }).sheetCells ?? {})
      }
      renderPreview={(cells) => <CellGrid cells={cells} />}
      renderDiff={(version, current) => <SheetDiffList from={version} to={current ?? {}} />}
      getCurrent={() => currentCells(sheet)}
    />
  )
}
