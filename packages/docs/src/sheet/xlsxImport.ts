// Excel (.xlsx) import for the collaborative spreadsheet.
//
// Import CREATES A NEW sheet file: the docs list parses the upload, creates a fresh
// `sheet` doc, and stashes the parsed cells in `pendingSheetImports` keyed by the new
// docId. When that sheet's SheetView mounts and its CollabSheet is ready, it drains the
// map and bulk-writes the cells (which then persist + replicate via the Yjs binding).
// The map entry is deleted on consumption so re-opening the doc never re-imports.
//
// Parsing uses ExcelJS (dynamically imported so it stays out of the initial bundle):
// unlike xlsx-js-style — which can WRITE styles but barely READS them (only fill comes
// back on read) — ExcelJS reads full cell styles (font / fill / alignment), so imported
// formatting (bold, color, size, background, alignment) survives, mirroring exportXlsx.

import { sanitizeLinkHref } from '../editor/sanitize.ts'

export type ImportCell = { v?: unknown; f?: string; s?: Record<string, unknown> } | null

/**
 * Import bounds, aligned with the collaborative grid. ExcelJS reports the LARGEST used
 * row/col, which a single far-flung cell (e.g. a stray `XFD1048576`) can inflate to
 * ~1M×16k — building that dense matrix would OOM the tab. Clamp to these bounds.
 */
export const MAX_IMPORT_ROWS = 1000
export const MAX_IMPORT_COLS = 100

/** A merged-cell range, 0-based (Univer convention). */
export interface MergeRange {
  startRow: number
  startColumn: number
  endRow: number
  endColumn: number
}

/**
 * A parsed FLOATING image (standard xlsx drawing), anchored to a top-left cell. `source` is a
 * self-contained base64 data URL (the binary rides along — no external host). Cell images (WPS
 * DISPIMG) are NOT handled here: that's a proprietary format ExcelJS can't read.
 */
export interface ParsedDrawing {
  source: string
  col: number
  row: number
}

/** A parsed hyperlink on a cell (0-based row/col). `display` is the cell's shown text. */
export interface ParsedHyperLink {
  row: number
  col: number
  url: string
  display?: string
}

/** A parsed WPS cell image (=DISPIMG) — imported as a native Univer cell image at (row,col). */
export interface ParsedCellImage {
  row: number
  col: number
  source: string
}

/** One parsed worksheet: cells + merges + floating images + cell images + hyperlinks. */
export interface ParsedSheet {
  name: string
  matrix: ImportCell[][]
  merges: MergeRange[]
  drawings?: ParsedDrawing[]
  cellImages?: ParsedCellImage[]
  hyperlinks?: ParsedHyperLink[]
}

/** The full parsed payload for an imported workbook: every VISIBLE worksheet. */
export interface SheetImport {
  sheets: ParsedSheet[]
  /** True when any sheet exceeded MAX_IMPORT_ROWS/COLS and was clamped. */
  truncated?: boolean
}

/** Distinguishes "couldn't parse the file at all" from "parsed OK, with caveats". */
export type ParseXlsxResult =
  | { ok: true; data: SheetImport }
  | { ok: false; reason: 'empty' | 'unreadable' }

/** New-sheet imports awaiting their SheetView to mount, keyed by docId. */
export const pendingSheetImports = new Map<string, SheetImport>()

/** Parse an A1 cell address (e.g. "AB12") to 0-based { row, col }, or null. */
function parseA1(addr: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(addr.trim())
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  const row = Number(m[2])
  if (!Number.isInteger(row) || row < 1) return null
  return { row: row - 1, col: col - 1 }
}

/** Parse an A1 range ("A1:E1") to a 0-based MergeRange, or null. */
function parseA1Range(range: string): MergeRange | null {
  const [a, b] = range.split(':')
  const s = parseA1(a ?? '')
  const e = parseA1(b ?? a ?? '')
  if (!s || !e) return null
  return {
    startRow: Math.min(s.row, e.row),
    startColumn: Math.min(s.col, e.col),
    endRow: Math.max(s.row, e.row),
    endColumn: Math.max(s.col, e.col),
  }
}

/** ARGB/RGB hex (possibly 8-digit ARGB) → Univer `#rrggbb`. */
function argbToHex(argb?: string): string | undefined {
  if (!argb) return undefined
  const s = argb.replace('#', '')
  if (/^[0-9a-fA-F]{8}$/.test(s)) return `#${s.slice(2)}`
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`
  return undefined
}

/** Minimal structural view of an ExcelJS cell (avoids a static type dep on exceljs). */
interface XlsxCell {
  value: unknown
  text?: string
  /** Formula string when the cell is a formula (used to detect WPS =DISPIMG cell images). */
  formula?: string
  /** Hyperlink target when the cell is a link (ExcelJS exposes it here + a {text,hyperlink} value). */
  hyperlink?: string
  // merged cells: every cell in a merge range reports the MASTER's value on read, so we
  // write the value only for the master and skip the slaves (else a merged title/label
  // repeats across its whole span).
  isMerged?: boolean
  address?: string
  master?: { address?: string }
  font?: {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strike?: boolean
    size?: number
    name?: string
    color?: { argb?: string }
  }
  fill?: { type?: string; pattern?: string; fgColor?: { argb?: string } }
  alignment?: { horizontal?: string; vertical?: string }
  numFmt?: string
  border?: {
    top?: { style?: string; color?: { argb?: string } }
    bottom?: { style?: string; color?: { argb?: string } }
    left?: { style?: string; color?: { argb?: string } }
    right?: { style?: string; color?: { argb?: string } }
  }
}

/** ExcelJS border style name → Univer BorderStyleTypes. */
const BORDER_STYLE: Record<string, number> = {
  thin: 1,
  hair: 2,
  dotted: 3,
  dashed: 4,
  dashDot: 5,
  dashDotDot: 6,
  double: 7,
  medium: 8,
  mediumDashed: 9,
  mediumDashDot: 10,
  mediumDashDotDot: 11,
  slantDashDot: 12,
  thick: 13,
}

/** JS Date → Excel serial day number (days since 1899-12-30, UTC-based to avoid TZ drift). */
function dateToSerial(d: Date): number {
  return (d.getTime() - Date.UTC(1899, 11, 30)) / 86400000
}

/** Map one ExcelJS border edge to a Univer border-style object, or undefined. */
function edge(e?: { style?: string; color?: { argb?: string } }): { s: number; cl: { rgb: string } } | undefined {
  if (!e?.style) return undefined
  const s = BORDER_STYLE[e.style] ?? 1
  const rgb = argbToHex(e.color?.argb) ?? '#000000'
  return { s, cl: { rgb } }
}

/** True for a real Date instance (robust across module realms). */
function isDate(v: unknown): v is Date {
  return Object.prototype.toString.call(v) === '[object Date]'
}

/** Chunked base64 encode of raw bytes (avoids the arg-count blowup of a single String.fromCharCode). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(binary)
}

/** ExcelJS media entry → a self-contained base64 data URL, or null if it has no usable binary. */
function mediaToDataUrl(media: { extension?: string; buffer?: unknown; base64?: string } | undefined): string | null {
  if (!media) return null
  const ext = media.extension === 'jpeg' ? 'jpeg' : media.extension === 'gif' ? 'gif' : 'png'
  if (typeof media.base64 === 'string' && media.base64) {
    return media.base64.startsWith('data:') ? media.base64 : `data:image/${ext};base64,${media.base64}`
  }
  // ExcelJS' Buffer polyfill is a Uint8Array subclass, so subarray/length work directly.
  const buf = media.buffer
  if (buf && typeof (buf as Uint8Array).length === 'number') {
    return `data:image/${ext};base64,${bytesToBase64(buf as Uint8Array)}`
  }
  return null
}

/** Extract the DISPIMG id from a WPS cell-image formula `=DISPIMG("ID_xxx", n)`, or null. */
export function extractDispImgId(formula: string | undefined): string | null {
  if (!formula) return null
  const m = /DISPIMG\(\s*"([^"]+)"/i.exec(formula)
  return m ? m[1] : null
}

/**
 * Parse WPS's proprietary cell-image parts to a map `DISPIMG id -> base64 data URL`. WPS stores
 * cell images as a `=DISPIMG("ID_…",n)` formula whose ID resolves through `xl/cellimages.xml`
 * (id → embed rel) + `xl/_rels/cellimages.xml.rels` (rel → media) + `xl/media/*`. ExcelJS can't
 * read these (not OpenXML), so we crack the zip ourselves. Regex over the (controlled, machine-
 * generated) XML — a full DOM parse buys little here. Empty map on any miss (no cell images).
 */
async function parseWpsCellImages(data: ArrayBuffer): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(data)
    const ciFile = zip.file('xl/cellimages.xml')
    if (!ciFile) return out
    const ci = await ciFile.async('string')
    const relsFile = zip.file('xl/_rels/cellimages.xml.rels')
    const relsXml = relsFile ? await relsFile.async('string') : ''

    // rId -> media path (relative to xl/). Handle Id/Target in either attribute order.
    const norm = (t: string) => t.replace(/^\/+/, '').replace(/^xl\//, '').replace(/^\.\.\//, '')
    const relMap = new Map<string, string>()
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = m[0]
      const id = /Id="([^"]+)"/.exec(tag)?.[1]
      const target = /Target="([^"]+)"/.exec(tag)?.[1]
      if (id && target) relMap.set(id, norm(target))
    }

    // Pair each cell image's DISPIMG id (cNvPr@name, "ID_…") with its media embed (blip@r:embed),
    // in document order — WPS emits one name + one embed per <etc:cellImage>.
    const names = [...ci.matchAll(/name="(ID_[^"]+)"/g)].map((x) => x[1])
    const embeds = [...ci.matchAll(/embed="([^"]+)"/g)].map((x) => x[1])
    const n = Math.min(names.length, embeds.length)
    for (let i = 0; i < n; i++) {
      const target = relMap.get(embeds[i])
      if (!target) continue
      const path = `xl/${target}`
      const mf = zip.file(path) ?? zip.file(target)
      if (!mf) continue
      const bytes = await mf.async('uint8array')
      const rawExt = (target.split('.').pop() || 'png').toLowerCase()
      const ext = rawExt === 'jpg' ? 'jpeg' : rawExt
      out.set(names[i], `data:image/${ext};base64,${bytesToBase64(bytes)}`)
    }
  } catch {
    // no cell images / unreadable — import the rest without them
  }
  return out
}

/** Map an ExcelJS cell to a Univer ICellData (value / formula + resolved style). */
function exceljsCellToUniver(cell: XlsxCell): ImportCell {
  // Skip a merged slave cell (keep only the master) so a merged title isn't repeated.
  if (cell.isMerged && cell.address && cell.master?.address && cell.master.address !== cell.address) {
    return null
  }
  const out: { v?: unknown; f?: string; s?: Record<string, unknown> } = {}
  let isDateValue = false

  const val = cell.value
  if (val !== null && val !== undefined) {
    if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') {
      out.v = val
    } else if (isDate(val)) {
      // Store as a REAL date (Excel serial + date number-format) so Univer renders it as a
      // date — not text — avoiding the "number stored as text" green marker / warning popup.
      out.v = dateToSerial(val)
      isDateValue = true
    } else if (typeof val === 'object') {
      const o = val as { formula?: string; result?: unknown }
      if (typeof o.formula === 'string') {
        // WPS "cell images" serialize as a =DISPIMG("ID_…",n) formula. Univer has no DISPIMG
        // function, so writing it as a formula renders the literal text in the cell. We can't
        // extract the WPS-proprietary image binary here (it's not standard-xlsx drawing data), so
        // blank the cell rather than pollute it with the formula string. (#1 — full cell-image
        // import would need parsing WPS's xl/cellimages.xml, deferred.)
        if (/DISPIMG/i.test(o.formula)) {
          // leave out.v / out.f unset — the cell carries no importable content
        } else {
          out.f = o.formula.startsWith('=') ? o.formula : `=${o.formula}`
          const r = o.result
          if (isDate(r)) {
            out.v = dateToSerial(r)
            isDateValue = true
          } else if (r != null && typeof r !== 'object') out.v = r
          else if (cell.text != null) out.v = cell.text
        }
      } else {
        // rich text / hyperlink / error / shared string → its plain display text (never the object)
        out.v = cell.text != null ? cell.text : ''
      }
    }
  }

  const style: Record<string, unknown> = {}
  // Dates: force a yyyy/m/d display (matches the source's WPS rendering) rather than the
  // file's stored numFmt, which is often US-style (mm-dd-yy) and reads wrong for CN users.
  // TODO: locale-aware date format — when multi-language ships, pick the pattern by user locale.
  if (isDateValue) style.n = { pattern: 'yyyy/m/d' }
  const font = cell.font
  if (font) {
    if (font.bold) style.bl = 1
    if (font.italic) style.it = 1
    if (font.underline) style.ul = { s: 1 }
    if (font.strike) style.st = { s: 1 }
    if (typeof font.size === 'number') style.fs = font.size
    if (font.name) style.ff = font.name
    const fc = argbToHex(font.color?.argb)
    if (fc) style.cl = { rgb: fc }
  }
  const fill = cell.fill
  if (fill && fill.type === 'pattern' && fill.pattern === 'solid') {
    const bg = argbToHex(fill.fgColor?.argb)
    if (bg) style.bg = { rgb: bg }
  }
  const al = cell.alignment
  if (al?.horizontal) style.ht = al.horizontal === 'center' ? 2 : al.horizontal === 'right' ? 3 : 1
  if (al?.vertical) style.vt = al.vertical === 'top' ? 1 : al.vertical === 'bottom' ? 3 : 2
  // Cell borders → Univer bd { t/b/l/r: { s: BorderStyleType, cl: { rgb } } }.
  const bo = cell.border
  if (bo) {
    const bd: Record<string, { s: number; cl: { rgb: string } }> = {}
    const t = edge(bo.top)
    const b = edge(bo.bottom)
    const l = edge(bo.left)
    const r = edge(bo.right)
    if (t) bd.t = t
    if (b) bd.b = b
    if (l) bd.l = l
    if (r) bd.r = r
    if (Object.keys(bd).length > 0) style.bd = bd
  }
  if (Object.keys(style).length > 0) out.s = style

  if (out.v === undefined && out.f === undefined && out.s === undefined) return null
  return out
}

/**
 * Parse an .xlsx ArrayBuffer into a cell matrix + merged ranges (first sheet), from A1.
 *
 * Only the FIRST worksheet is imported; extra sheets are reported via `droppedSheetCount`
 * so the caller can warn the user instead of silently losing them. The used range is
 * clamped to MAX_IMPORT_ROWS/COLS to avoid a dense-matrix OOM on far-flung cells.
 *
 * Returns a discriminated result so the caller can tell a real parse failure
 * (`{ ok: false }`) apart from a successful-but-caveated import (multi-sheet / truncated).
 * Async — ExcelJS is loaded on demand.
 */
export async function parseXlsxToMatrix(data: ArrayBuffer): Promise<ParseXlsxResult> {
  try {
    const mod = (await import('exceljs')) as unknown as {
      Workbook: new () => { xlsx: { load: (b: ArrayBuffer) => Promise<unknown> }; worksheets: unknown[] }
      default?: { Workbook: new () => unknown }
    }
    const WorkbookCtor = mod.Workbook ?? (mod.default as { Workbook: new () => unknown } | undefined)?.Workbook
    if (!WorkbookCtor) {
      console.error('[xlsxImport] ExcelJS Workbook constructor not found')
      return { ok: false, reason: 'unreadable' }
    }
    const wb = new (WorkbookCtor as new () => {
      xlsx: { load: (b: ArrayBuffer) => Promise<unknown> }
      getImage?: (id: number) => { extension?: string; base64?: string; buffer?: Uint8Array } | undefined
      worksheets: Array<{
        name?: string
        state?: string
        rowCount: number
        columnCount: number
        getCell: (r: number, c: number) => XlsxCell
        getImages?: () => Array<{ imageId: string; range?: { tl?: { nativeCol?: number; nativeRow?: number } } }>
        model?: { merges?: string[] }
      }>
    })()
    // Clone the buffer for our own zip read BEFORE ExcelJS consumes `data` (some builds detach the
    // ArrayBuffer during load, which would leave JSZip nothing to read).
    const rawForCellImages = data.slice(0)
    await wb.xlsx.load(data)
    // Import EVERY visible worksheet (each becomes a sheet tab in the workbook). Hidden /
    // very-hidden sheets are skipped — not user content, and previously the source of the
    // bogus "multiple worksheets" notice on single-sheet files. ExcelJS reports the LARGEST
    // used row/col, which a single far-flung cell can inflate to ~1M×16k, so clamp each
    // sheet to the collaborative grid bounds (never build a giant dense matrix / OOM).
    const sheets: ParsedSheet[] = []
    let truncated = false
    // WPS cell images (=DISPIMG) — resolved from the zip's private cellimages parts (ExcelJS can't
    // read them). Map is shared across sheets; DISPIMG ids are unique per workbook.
    const dispImgMap = await parseWpsCellImages(rawForCellImages)
    wb.worksheets.forEach((ws, i) => {
      if (ws.state && ws.state !== 'visible') return
      const rawRows = ws.rowCount
      const rawCols = ws.columnCount
      if (rawRows <= 0 || rawCols <= 0) return
      const rows = Math.min(rawRows, MAX_IMPORT_ROWS)
      const cols = Math.min(rawCols, MAX_IMPORT_COLS)
      if (rawRows > MAX_IMPORT_ROWS || rawCols > MAX_IMPORT_COLS) truncated = true
      const matrix: ImportCell[][] = []
      const hyperlinks: ParsedHyperLink[] = []
      // Floating images (below). WPS cell images go to cellImages (imported as native cell images).
      const drawings: ParsedDrawing[] = []
      const cellImages: ParsedCellImage[] = []
      for (let r = 1; r <= rows; r++) {
        const row: ImportCell[] = []
        for (let c = 1; c <= cols; c++) {
          const xc = ws.getCell(r, c)
          row.push(exceljsCellToUniver(xc))
          // Hyperlinks live outside cell data in Univer, so collect them separately (applied via the
          // HyperLinkModel after import). The cell's display text is already captured in the matrix.
          // Sanitize at the import boundary: an .xlsx cell hyperlink is untrusted input, so it must
          // pass the app's link-scheme whitelist (http/https/mailto) — the same rule the editor
          // enforces at both parse and render (editor/sanitize.ts). Drop javascript:/data:/vbscript:
          // etc. so a crafted workbook can't seed a pseudo-scheme link into the sheet model.
          const rawUrl = typeof xc.hyperlink === 'string' ? xc.hyperlink : undefined
          const url = sanitizeLinkHref(rawUrl) ?? undefined
          if (url) {
            hyperlinks.push({ row: r - 1, col: c - 1, url, display: typeof xc.text === 'string' ? xc.text : undefined })
          }
          // WPS cell image: the cell holds a =DISPIMG("ID",n) formula (exceljsCellToUniver blanked
          // it). If we resolved that ID's binary, import it as a NATIVE Univer cell image at the
          // cell (fits the cell, moves with it) — matching the source (not a floating object).
          const dispId = extractDispImgId(xc.formula ?? (xc.value as { formula?: string } | null)?.formula)
          const dispSrc = dispId ? dispImgMap.get(dispId) : undefined
          if (dispSrc) cellImages.push({ row: r - 1, col: c - 1, source: dispSrc })
        }
        matrix.push(row)
      }
      const merges: MergeRange[] = []
      for (const rng of ws.model?.merges ?? []) {
        const m = parseA1Range(rng)
        if (m && (m.endRow > m.startRow || m.endColumn > m.startColumn) && m.startRow < rows && m.startColumn < cols) {
          merges.push({
            startRow: m.startRow,
            startColumn: m.startColumn,
            endRow: Math.min(m.endRow, rows - 1),
            endColumn: Math.min(m.endColumn, cols - 1),
          })
        }
      }
      // Floating images (standard xlsx drawings): ExcelJS exposes them per-sheet with an
      // imageId into the workbook media. Convert each to a base64 data URL anchored at its
      // top-left cell. Wrapped defensively — a missing/odd image layer must not fail the import.
      // (Appends to `drawings`, which already holds any WPS cell images found above.)
      try {
        for (const im of ws.getImages?.() ?? []) {
          const media = wb.getImage?.(Number(im.imageId))
          const source = media ? mediaToDataUrl(media) : null
          if (!source) continue
          const col = im.range?.tl?.nativeCol ?? 0
          const row = im.range?.tl?.nativeRow ?? 0
          // Anchor against the DECLARED grid (1000×100), NOT the used-cell range: a floating image
          // is usually parked in empty space below/beside the data, so `row/col >= used rows/cols`
          // is normal and must NOT drop it. Only reject anchors outside the whole sheet.
          if (col < 0 || row < 0 || col >= MAX_IMPORT_COLS || row >= MAX_IMPORT_ROWS) continue
          drawings.push({ source, col, row })
        }
      } catch {
        // image layer unreadable — import cells/merges without images
      }
      sheets.push({ name: ws.name ?? `Sheet${i + 1}`, matrix, merges, drawings, cellImages, hyperlinks })
    })
    if (sheets.length === 0) return { ok: false, reason: 'empty' }
    return { ok: true, data: { sheets, truncated } }
  } catch (err) {
    // Surface the real cause instead of collapsing every failure into a bare null — a
    // corrupt file and an ExcelJS bug are otherwise indistinguishable to the caller.
    console.error('[xlsxImport] failed to parse .xlsx:', err)
    return { ok: false, reason: 'unreadable' }
  }
}
