// Pure xlsx-export helpers for the sheet dims/merges, extracted from SheetView.buildWs so the
// legacy-bare-key handling (P1-1) is unit-testable without dragging XLSX / React / Univer into a
// test. These operate on plain [key, value] iterables (the caller passes Y.Map entries).
//
// V2 writes dim/merge keys prefixed by the logical sheet id (`${logicalId}:c1`, `${logicalId}:sr:sc:er:ec`).
// Legacy V1 (#537) wrote them UNPREFIXED (bare `c1`/`r5`, bare `sr:sc:er:ec`) and never migrated
// them in the Y.Map. The binding reads bare keys as the 'default' sheet on OPEN, so the export path
// must mirror that (P1-1) or a legacy doc exported without re-editing loses all widths/heights/merges.
import type * as XLSX from 'xlsx-js-style'

/**
 * Column widths / row heights for one logical sheet. Prefixed (V2, possibly-edited) values take
 * priority; for the legacy 'default' sheet, bare V1 keys only fill gaps so an edited dim overrides
 * its stale legacy twin.
 */
export function buildSheetDims(
  logicalId: string,
  dimEntries: Iterable<[string, number]>,
): { cols: XLSX.ColInfo[]; rows: XLSX.RowInfo[] } {
  const entries = [...dimEntries]
  const prefix = `${logicalId}:`
  const isDefault = logicalId === 'default'
  const cols: XLSX.ColInfo[] = []
  const rows: XLSX.RowInfo[] = []
  for (const [key, size] of entries) {
    if (!key.startsWith(prefix)) continue
    const dim = key.slice(prefix.length)
    const idx = Number(dim.slice(1))
    if (!Number.isInteger(idx) || typeof size !== 'number' || size <= 0) continue
    if (dim.startsWith('c')) cols[idx] = { wpx: size }
    else if (dim.startsWith('r')) rows[idx] = { hpx: size }
  }
  // P1-1: legacy V1 bare dim keys (`c1`/`r5`, no logical prefix) belong to 'default'.
  if (isDefault) {
    for (const [key, size] of entries) {
      if (key.includes(':')) continue // prefixed (any logicalId) — handled above / not ours
      const idx = Number(key.slice(1))
      if (!Number.isInteger(idx) || typeof size !== 'number' || size <= 0) continue
      if (key.startsWith('c')) { if (!cols[idx]) cols[idx] = { wpx: size } }
      else if (key.startsWith('r')) { if (!rows[idx]) rows[idx] = { hpx: size } }
    }
  }
  return { cols, rows }
}

/**
 * Merge ranges for one logical sheet. Prefixed (V2) merges are emitted first; for the legacy
 * 'default' sheet, bare V1 merge keys are added unless a prefixed twin already covers the same range.
 */
export function buildSheetMerges(
  logicalId: string,
  mergeEntries: Iterable<[string, boolean]>,
): XLSX.Range[] {
  const entries = [...mergeEntries]
  const prefix = `${logicalId}:`
  const isDefault = logicalId === 'default'
  const merges: XLSX.Range[] = []
  const seen = new Set<string>()
  for (const [key, on] of entries) {
    if (!on || !key.startsWith(prefix)) continue
    const parts = key.slice(prefix.length).split(':').map((n) => Number(n))
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) continue
    const [sr, sc, er, ec] = parts
    seen.add(`${sr}:${sc}:${er}:${ec}`)
    merges.push({ s: { r: sr, c: sc }, e: { r: er, c: ec } })
  }
  // P1-1: legacy V1 bare merge keys (`sr:sc:er:ec`, no logical prefix) belong to 'default'.
  if (isDefault) {
    for (const [key, on] of entries) {
      if (!on) continue
      const parts = key.split(':').map((n) => Number(n))
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) continue
      const [sr, sc, er, ec] = parts
      const sig = `${sr}:${sc}:${er}:${ec}`
      if (seen.has(sig)) continue // prefixed twin already emitted
      seen.add(sig)
      merges.push({ s: { r: sr, c: sc }, e: { r: er, c: ec } })
    }
  }
  return merges
}

/**
 * Produce an Excel-legal, unique-within-the-book sheet name for one logical sheet (P2).
 * Excel rules: ≤31 chars, none of []:*?/\, non-empty. When a sanitized name collides with one
 * already used, append `(n)` — reserving room for the suffix so the total stays ≤31 (the earlier
 * fixed slice(0,28) overflowed to 32 once n≥10 and XLSX.book_append_sheet then threw, aborting the
 * whole export). `used` is a lower-cased set the caller carries across sheets; this MUTATES it.
 */
export function excelSheetName(raw: string | undefined, used: Set<string>): string {
  const name = (raw || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let n = name
  let i = 2
  while (used.has(n.toLowerCase())) {
    const suffix = `(${i++})`
    n = `${name.slice(0, 31 - suffix.length)}${suffix}`
  }
  used.add(n.toLowerCase())
  return n
}

